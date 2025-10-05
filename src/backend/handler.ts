import { createHash } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = process.env.TABLE_NAME;

if (!TABLE_NAME) {
  throw new Error('TABLE_NAME environment variable is required');
}

class ClientError extends Error {
  readonly statusCode = 400;
}

type HttpMethod = 'GET' | 'POST' | 'OPTIONS' | string;

type LambdaFunctionUrlEvent = {
  readonly requestContext?: {
    readonly http?: {
      readonly method?: HttpMethod;
      readonly path?: string;
    };
  };
  readonly body?: string | null;
  readonly headers?: Record<string, string | undefined>;
};

type LambdaResponse = {
  readonly statusCode: number;
  readonly headers: Record<string, string>;
  readonly body: string;
};

interface AlgorithmOptionDefinition {
  readonly key: string;
  readonly label: string;
  readonly type: 'integer' | 'number' | 'string' | 'boolean';
  readonly description: string;
  readonly defaultValue: number | string | boolean;
  readonly minimum?: number;
  readonly maximum?: number;
}

interface AlgorithmMetadata {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly inputExplanation: string;
  readonly inputExample: unknown;
  readonly options: AlgorithmOptionDefinition[];
}

interface AlgorithmRunContext {
  readonly options: Record<string, number | string | boolean>;
}

interface AlgorithmRunResult<TOutput> {
  readonly output: TOutput;
  readonly summary: string;
  readonly diagnostics?: Record<string, unknown>;
}

abstract class AlgorithmBase<TInput, TOutput> {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly inputExplanation: string;
  abstract readonly inputExample: TInput;
  protected abstract readonly optionDefinitions: AlgorithmOptionDefinition[];

  abstract parseInput(raw: unknown): TInput;

  prepare(rawInput: unknown, rawOptions: unknown): {
    input: TInput;
    options: Record<string, number | string | boolean>;
  } {
    const input = this.parseInput(rawInput);
    const options = this.parseOptions(rawOptions);
    return { input, options };
  }

  protected parseOptions(raw: unknown): Record<string, number | string | boolean> {
    const provided = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
    const parsed: Record<string, number | string | boolean> = {};

    for (const def of this.optionDefinitions) {
      const value = provided[def.key];
      if (value === undefined || value === null || value === '') {
        parsed[def.key] = def.defaultValue;
        continue;
      }

      switch (def.type) {
        case 'integer': {
          const num = Number(value);
          if (!Number.isFinite(num) || !Number.isInteger(num)) {
            throw new ClientError(`Option \"${def.label}\" must be an integer value.`);
          }
          if (def.minimum !== undefined && num < def.minimum) {
            throw new ClientError(`Option \"${def.label}\" must be >= ${def.minimum}.`);
          }
          if (def.maximum !== undefined && num > def.maximum) {
            throw new ClientError(`Option \"${def.label}\" must be <= ${def.maximum}.`);
          }
          parsed[def.key] = num;
          break;
        }
        case 'number': {
          const num = Number(value);
          if (!Number.isFinite(num)) {
            throw new ClientError(`Option \"${def.label}\" must be a numeric value.`);
          }
          if (def.minimum !== undefined && num < def.minimum) {
            throw new ClientError(`Option \"${def.label}\" must be >= ${def.minimum}.`);
          }
          if (def.maximum !== undefined && num > def.maximum) {
            throw new ClientError(`Option \"${def.label}\" must be <= ${def.maximum}.`);
          }
          parsed[def.key] = num;
          break;
        }
        case 'boolean': {
          if (typeof value === 'boolean') {
            parsed[def.key] = value;
          } else if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (normalized === 'true' || normalized === '1') {
              parsed[def.key] = true;
            } else if (normalized === 'false' || normalized === '0') {
              parsed[def.key] = false;
            } else {
              throw new ClientError(`Option \"${def.label}\" must be a boolean.`);
            }
          } else if (typeof value === 'number') {
            parsed[def.key] = value !== 0;
          } else {
            throw new ClientError(`Option \"${def.label}\" must be a boolean.`);
          }
          break;
        }
        case 'string': {
          parsed[def.key] = String(value);
          break;
        }
        default: {
          parsed[def.key] = String(value);
        }
      }
    }

    return parsed;
  }

  getMetadata(): AlgorithmMetadata {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      inputExplanation: this.inputExplanation,
      inputExample: this.inputExample,
      options: this.optionDefinitions
    };
  }

  async run(rawInput: unknown, rawOptions: unknown): Promise<AlgorithmRunResult<TOutput>> {
    const prepared = this.prepare(rawInput, rawOptions);
    return this.runWithPrepared(prepared);
  }

  runWithPrepared(prepared: {
    input: TInput;
    options: Record<string, number | string | boolean>;
  }): Promise<AlgorithmRunResult<TOutput>> {
    return this.execute(prepared.input, { options: prepared.options });
  }

  protected abstract execute(input: TInput, context: AlgorithmRunContext): Promise<AlgorithmRunResult<TOutput>>;
}

interface KargerInput {
  vertices: string[];
  edges: Array<[string, string]>;
}

interface KargerOutput {
  minCut: number;
  partitions: [string[], string[]];
}

class KargerMinCutAlgorithm extends AlgorithmBase<KargerInput, KargerOutput> {
  readonly id = 'karger-min-cut';
  readonly name = "Karger's Minimum Cut";
  readonly description = 'Estimates the minimum cut of an undirected graph using K\u00e4rger\'s randomized contraction algorithm.';
  readonly inputExplanation = 'Provide the undirected graph as a JSON object with an optional "vertices" array and a required "edges" array of [source, target] pairs. Vertices not listed will be inferred from the edges.';
  readonly inputExample: KargerInput = {
    vertices: ['A', 'B', 'C', 'D'],
    edges: [
      ['A', 'B'],
      ['A', 'C'],
      ['B', 'C'],
      ['B', 'D'],
      ['C', 'D']
    ]
  };
  protected readonly optionDefinitions: AlgorithmOptionDefinition[] = [
    {
      key: 'iterations',
      label: 'Iterations',
      type: 'integer',
      description: 'Number of random contraction runs to perform. More iterations increase the probability of finding the true minimum cut.',
      defaultValue: 40,
      minimum: 1,
      maximum: 1000
    }
  ];

  parseInput(raw: unknown): KargerInput {
    if (!raw || typeof raw !== 'object') {
      throw new ClientError('Input must be a JSON object with an "edges" property.');
    }
    const input = raw as Record<string, unknown>;
    const rawEdges = input.edges;
    if (!Array.isArray(rawEdges) || rawEdges.length === 0) {
      throw new ClientError('Input must include a non-empty "edges" array.');
    }

    const edges: Array<[string, string]> = rawEdges.map((edge, index) => {
      if (Array.isArray(edge) && edge.length === 2) {
        const [from, to] = edge;
        return [String(from), String(to)];
      }
      if (edge && typeof edge === 'object') {
        const e = edge as Record<string, unknown>;
        const from = e.from ?? e.source ?? e.u;
        const to = e.to ?? e.target ?? e.v;
        if (from !== undefined && to !== undefined) {
          return [String(from), String(to)];
        }
      }
      throw new ClientError(`Edge at index ${index} must be an array like [from, to] or an object with from/to keys.`);
    });

    const explicitVertices = Array.isArray(input.vertices)
      ? (input.vertices as unknown[]).map((v) => String(v))
      : [];

    const vertices = Array.from(new Set([
      ...explicitVertices,
      ...edges.flatMap(([from, to]) => [from, to])
    ]));

    if (vertices.length < 2) {
      throw new ClientError('The graph must contain at least two vertices.');
    }

    return { vertices, edges };
  }

  protected async execute(input: KargerInput, context: AlgorithmRunContext): Promise<AlgorithmRunResult<KargerOutput>> {
    const iterations = this.resolveIterations(input, context.options);
    let bestCut = Number.POSITIVE_INFINITY;
    let bestPartitions: [string[], string[]] = [[], []];
    let bestIteration = 0;
    const runHistory: Array<{ iteration: number; cut: number }> = [];

    for (let iteration = 1; iteration <= iterations; iteration += 1) {
      const { cut, partitions } = this.singleRun(input);
      runHistory.push({ iteration, cut });
      if (cut < bestCut) {
        bestCut = cut;
        bestPartitions = partitions;
        bestIteration = iteration;
      }
    }

    const summary = `Estimated minimum cut is ${bestCut} based on ${iterations} iteration${iterations === 1 ? '' : 's'}.`;

    return {
      output: {
        minCut: bestCut,
        partitions: bestPartitions
      },
      summary,
      diagnostics: {
        iterations,
        bestIteration,
        runHistory
      }
    };
  }

  private resolveIterations(input: KargerInput, options: Record<string, number | string | boolean>): number {
    const provided = options.iterations;
    if (typeof provided === 'number' && Number.isInteger(provided) && provided >= 1) {
      return provided;
    }
    const n = input.vertices.length;
    const heuristic = Math.max(1, Math.min(1000, n * n));
    return heuristic;
  }

  private singleRun(input: KargerInput): { cut: number; partitions: [string[], string[]] } {
    let edges = input.edges.map(([from, to]) => [from, to] as [string, string]);
    const components = new Map<string, Set<string>>();

    for (const vertex of input.vertices) {
      components.set(vertex, new Set([vertex]));
    }

    let step = 0;

    while (components.size > 2 && edges.length > 0) {
      step += 1;
      const randomIndex = Math.floor(Math.random() * edges.length);
      const [rawFrom, rawTo] = edges[randomIndex];
      const from = this.findRepresentative(rawFrom, components);
      const to = this.findRepresentative(rawTo, components);

      if (from === to) {
        edges.splice(randomIndex, 1);
        continue;
      }

      const mergedLabel = this.mergeComponents(from, to, components, step);
      edges = edges
        .map(([a, b]) => {
          const newA = a === from || a === to ? mergedLabel : a;
          const newB = b === from || b === to ? mergedLabel : b;
          return [newA, newB] as [string, string];
        })
        .filter(([a, b]) => a !== b);
    }

    const remaining = Array.from(components.values());
    if (remaining.length !== 2) {
      // Degenerate graph; treat remaining vertices as separate partitions
      if (remaining.length === 1) {
        const only = Array.from(remaining[0]);
        return { cut: 0, partitions: [only, []] };
      }
      const all = Array.from(components.values()).map((set) => Array.from(set));
      const flat = all.flat();
      return { cut: 0, partitions: [flat, []] };
    }

    const [partA, partB] = remaining.map((set) => Array.from(set)) as [string[], string[]];
    const cut = this.computeCutSize(partA, partB, input.edges);
    return { cut, partitions: [partA, partB] };
  }

  private findRepresentative(label: string, components: Map<string, Set<string>>): string {
    if (components.has(label)) {
      return label;
    }
    for (const [key, members] of components.entries()) {
      if (members.has(label)) {
        return key;
      }
    }
    throw new Error(`Vertex ${label} is missing from the component map.`);
  }

  private mergeComponents(from: string, to: string, components: Map<string, Set<string>>, step: number): string {
    const fromSet = components.get(from);
    const toSet = components.get(to);
    if (!fromSet || !toSet) {
      throw new Error('Attempted to merge components that do not exist.');
    }
    components.delete(from);
    components.delete(to);
    const mergedSet = new Set<string>([...fromSet, ...toSet]);
    const mergedLabel = `${Array.from(mergedSet).sort().join('|')}#${step}`;
    components.set(mergedLabel, mergedSet);
    return mergedLabel;
  }

  private computeCutSize(partA: string[], partB: string[], edges: Array<[string, string]>): number {
    const setA = new Set(partA);
    const setB = new Set(partB);
    let cut = 0;
    for (const [from, to] of edges) {
      const inA = setA.has(from);
      const inB = setB.has(from);
      const outA = setA.has(to);
      const outB = setB.has(to);
      if ((inA && outB) || (inB && outA)) {
        cut += 1;
      }
    }
    return cut;
  }
}

class AlgorithmRegistry {
  private readonly algorithms = new Map<string, AlgorithmBase<unknown, unknown>>();

  register<TInput, TOutput>(algorithm: AlgorithmBase<TInput, TOutput>): void {
    if (this.algorithms.has(algorithm.id)) {
      throw new Error(`Algorithm with id ${algorithm.id} is already registered.`);
    }
    this.algorithms.set(algorithm.id, algorithm as AlgorithmBase<unknown, unknown>);
  }

  get(id: string): AlgorithmBase<unknown, unknown> | undefined {
    return this.algorithms.get(id);
  }

  list(): AlgorithmMetadata[] {
    return Array.from(this.algorithms.values()).map((algorithm) => algorithm.getMetadata());
  }
}

const registry = new AlgorithmRegistry();
registry.register(new KargerMinCutAlgorithm());

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: {
    removeUndefinedValues: true
  }
});

const baseHeaders = Object.freeze({
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': '*'
});

export const handler = async (event: LambdaFunctionUrlEvent): Promise<LambdaResponse> => {
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = normalisePath(event.requestContext?.http?.path);

  if (method === 'OPTIONS') {
    return buildResponse(204, '');
  }

  try {
    if (method === 'GET' && path === '/algorithms') {
      return await handleListAlgorithms();
    }

    if (method === 'POST' && path === '/run') {
      return await handleRunAlgorithm(event.body ?? '');
    }

    if (method === 'GET' && path === '/health') {
      return buildResponse(200, JSON.stringify({ status: 'ok' }));
    }

    return buildResponse(404, JSON.stringify({ message: 'Not Found' }));
  } catch (error) {
    console.error('Handler error', error);
    if (error instanceof ClientError) {
      return buildResponse(error.statusCode, JSON.stringify({ message: error.message }));
    }
    const message = error instanceof Error ? error.message : 'Internal server error';
    return buildResponse(500, JSON.stringify({ message }));
  }
};

const handleListAlgorithms = async (): Promise<LambdaResponse> => {
  const algorithms = registry.list();
  return buildResponse(200, JSON.stringify({ algorithms }));
};

const handleRunAlgorithm = async (body: string): Promise<LambdaResponse> => {
  let payload: Record<string, unknown>;
  try {
    payload = parseJson(body);
  } catch (error) {
    return buildResponse(400, JSON.stringify({ message: error instanceof Error ? error.message : 'Invalid JSON payload' }));
  }

  const algorithmId = typeof payload.algorithmId === 'string' ? payload.algorithmId : undefined;
  if (!algorithmId) {
    return buildResponse(400, JSON.stringify({ message: 'Missing required property "algorithmId".' }));
  }

  const algorithm = registry.get(algorithmId);
  if (!algorithm) {
    return buildResponse(404, JSON.stringify({ message: `Algorithm with id "${algorithmId}" was not found.` }));
  }

  const rawInput = payload.input ?? {};
  const rawOptions = payload.options ?? {};

  const prepared = algorithm.prepare(rawInput, rawOptions);

  const cacheKey = createCacheKey(algorithmId, prepared.input, prepared.options);

  const cached = await dynamo.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { id: cacheKey }
  }));

  if (cached.Item?.result) {
    const result = augmentResultWithOptions(
      cached.Item.result as AlgorithmRunResult<unknown>,
      prepared.options
    );
    return buildResponse(200, JSON.stringify({
      algorithmId,
      cached: true,
      result
    }));
  }

  const runResult = await algorithm.runWithPrepared(prepared);
  const result = augmentResultWithOptions(runResult, prepared.options);

  await dynamo.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      id: cacheKey,
      algorithmId,
      createdAt: new Date().toISOString(),
      result
    }
  }));

  return buildResponse(200, JSON.stringify({
    algorithmId,
    cached: false,
    result
  }));
};

const buildResponse = (statusCode: number, body: string): LambdaResponse => ({
  statusCode,
  headers: baseHeaders,
  body
});

const augmentResultWithOptions = <TOutput>(
  result: AlgorithmRunResult<TOutput>,
  options: Record<string, number | string | boolean>
): AlgorithmRunResult<TOutput> => ({
  ...result,
  diagnostics: {
    ...result.diagnostics,
    optionsUsed: options
  }
});

const normalisePath = (path?: string): string => {
  if (!path) {
    return '/';
  }
  try {
    const url = new URL(path, 'https://placeholder');
    return url.pathname.replace(/\/+$/, '') || '/';
  } catch {
    return path.replace(/\/+$/, '') || '/';
  }
};

const parseJson = (body: string): Record<string, unknown> => {
  if (!body) {
    throw new ClientError('Request body is required.');
  }
  try {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object') {
      throw new ClientError('JSON payload must be an object.');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ClientError('Request body contains invalid JSON.');
    }
    throw error;
  }
};

const createCacheKey = (algorithmId: string, input: unknown, options: unknown): string => {
  const payload = {
    algorithmId,
    input: stableStringify(input),
    options: stableStringify(options)
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
};

const stableStringify = (value: unknown): string => {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB));
  return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`).join(',')}}`;
};

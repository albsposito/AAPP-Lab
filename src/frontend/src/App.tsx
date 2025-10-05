import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { BACKEND_URL } from './constants';

type AlgorithmOptionDefinition = {
  key: string;
  label: string;
  type: 'integer' | 'number' | 'string' | 'boolean';
  description: string;
  defaultValue: number | string | boolean;
  minimum?: number;
  maximum?: number;
};

type AlgorithmSummary = {
  id: string;
  name: string;
  description: string;
  inputExplanation: string;
  inputExample: unknown;
  options: AlgorithmOptionDefinition[];
};

type AlgorithmRunResponse = {
  algorithmId: string;
  cached: boolean;
  result: {
    output: unknown;
    summary: string;
    diagnostics?: Record<string, unknown>;
  };
};

type ApiState<T> = {
  data?: T;
  loading: boolean;
  error?: string;
};

const initialApiState = <T,>(): ApiState<T> => ({ loading: false });

const App = () => {
  const [algorithms, setAlgorithms] = useState<ApiState<AlgorithmSummary[]>>(initialApiState);
  const [selectedId, setSelectedId] = useState<string>('');
  const [inputValue, setInputValue] = useState<string>('');
  const [optionsState, setOptionsState] = useState<Record<string, string>>({});
  const [runState, setRunState] = useState<ApiState<AlgorithmRunResponse>>(initialApiState);

  useEffect(() => {
    const controller = new AbortController();
    const fetchAlgorithms = async () => {
      setAlgorithms({ loading: true });
      try {
        const response = await fetch(`${BACKEND_URL.replace(/\/$/, '')}/algorithms`, {
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(`Backend responded with ${response.status}`);
        }
        const payload = await response.json();
        const list = (payload.algorithms ?? []) as AlgorithmSummary[];
        setAlgorithms({ loading: false, data: list });
        if (list.length > 0) {
          const first = list[0];
          setSelectedId(first.id);
          setInputValue(formatInputExample(first.inputExample));
          setOptionsState(mapDefaultOptions(first.options));
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setAlgorithms({
            loading: false,
            error: error instanceof Error ? error.message : 'Unable to load algorithms'
          });
        }
      }
    };

    fetchAlgorithms();
    return () => controller.abort();
  }, []);

  const selectedAlgorithm = useMemo(() => {
    if (!algorithms.data) {
      return undefined;
    }
    return algorithms.data.find((algorithm) => algorithm.id === selectedId);
  }, [algorithms.data, selectedId]);

  useEffect(() => {
    if (!selectedAlgorithm) {
      return;
    }
    setInputValue(formatInputExample(selectedAlgorithm.inputExample));
    setOptionsState(mapDefaultOptions(selectedAlgorithm.options));
  }, [selectedAlgorithm]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedAlgorithm) {
      return;
    }

    let parsedInput: unknown;
    try {
      parsedInput = JSON.parse(inputValue);
    } catch (error) {
      setRunState({ loading: false, error: 'Input must be valid JSON.' });
      return;
    }

    const optionsPayload = buildOptionsPayload(selectedAlgorithm.options, optionsState);

    setRunState({ loading: true });

    try {
      const response = await fetch(`${BACKEND_URL.replace(/\/$/, '')}/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          algorithmId: selectedAlgorithm.id,
          input: parsedInput,
          options: optionsPayload
        })
      });

      if (!response.ok) {
        const message = await safeReadError(response);
        throw new Error(message);
      }

      const payload = (await response.json()) as AlgorithmRunResponse;
      setRunState({ loading: false, data: payload });
    } catch (error) {
      setRunState({
        loading: false,
        error: error instanceof Error ? error.message : 'Unable to execute algorithm'
      });
    }
  };

  return (
    <main>
      <header>
        <h1>Algorithm Playground</h1>
        <p>
          Select an algorithm, provide the required input, and execute it directly from your browser.
          Results are cached automatically for identical requests to help you stay within the AWS Free Tier limits.
        </p>
      </header>

      <section className="panel">
        <h2>1. Choose an algorithm</h2>
        {algorithms.loading && <p>Loading algorithms...</p>}
        {algorithms.error && <p className="error-message">{algorithms.error}</p>}
        {algorithms.data && algorithms.data.length > 0 && (
          <div>
            <label htmlFor="algorithm-select">Available algorithms</label>
            <select
              id="algorithm-select"
              value={selectedId}
              onChange={(event) => setSelectedId(event.target.value)}
            >
              {algorithms.data.map((algorithm) => (
                <option value={algorithm.id} key={algorithm.id}>
                  {algorithm.name}
                </option>
              ))}
            </select>
            {selectedAlgorithm && (
              <p style={{ marginTop: '0.5rem' }}>{selectedAlgorithm.description}</p>
            )}
          </div>
        )}
      </section>

      {selectedAlgorithm && (
        <section className="panel">
          <h2>2. Provide the input</h2>
          <p>{selectedAlgorithm.inputExplanation}</p>
          <form onSubmit={onSubmit}>
            <label htmlFor="algorithm-input">JSON input</label>
            <textarea
              id="algorithm-input"
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              spellCheck={false}
            />

            {selectedAlgorithm.options.length > 0 && (
              <div>
                <h3 style={{ marginTop: '1.5rem', marginBottom: '0.5rem' }}>Execution options</h3>
                {selectedAlgorithm.options.map((option) => (
                  <div key={option.key} style={{ marginBottom: '1rem' }}>
                    <label htmlFor={`option-${option.key}`}>{option.label}</label>
                    <OptionInput
                      option={option}
                      value={optionsState[option.key] ?? ''}
                      onChange={(value) =>
                        setOptionsState((current) => ({ ...current, [option.key]: value }))
                      }
                    />
                    <small style={{ color: '#6b7280' }}>{option.description}</small>
                  </div>
                ))}
              </div>
            )}

            <button type="submit" disabled={runState.loading}>
              {runState.loading ? 'Running…' : 'Run algorithm'}
            </button>
          </form>

          {runState.error && <p className="error-message">{runState.error}</p>}

          {runState.data && (
            <div className="result-card">
              <h3 style={{ marginTop: 0 }}>Result</h3>
              <p>{runState.data.result.summary}</p>
              <div className="status-row">
                <span>Algorithm: {selectedAlgorithm.name}</span>
                <span>{runState.data.cached ? 'Cached result' : 'Fresh execution'}</span>
              </div>
              <h4>Output</h4>
              <pre className="code-block">{formatJson(runState.data.result.output)}</pre>
              {runState.data.result.diagnostics && (
                <>
                  <h4>Diagnostics</h4>
                  <pre className="code-block">{formatJson(runState.data.result.diagnostics)}</pre>
                </>
              )}
            </div>
          )}
        </section>
      )}

      <p className="footer-note">
        Built for experimentation on the AWS Free Tier. Extend the platform by implementing and registering new
        algorithms in the backend.
      </p>
    </main>
  );
};

const OptionInput = ({
  option,
  value,
  onChange
}: {
  option: AlgorithmOptionDefinition;
  value: string;
  onChange: (value: string) => void;
}) => {
  const commonProps = {
    id: `option-${option.key}`,
    value,
    onChange: (event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)
  };

  if (option.type === 'integer' || option.type === 'number') {
    return (
      <input
        type="number"
        inputMode="numeric"
        min={option.minimum}
        max={option.maximum}
        step={option.type === 'integer' ? 1 : 'any'}
        {...commonProps}
      />
    );
  }

  if (option.type === 'boolean') {
    return (
      <select
        id={`option-${option.key}`}
        value={value || String(option.defaultValue)}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)}
      >
        <option value="true">True</option>
        <option value="false">False</option>
      </select>
    );
  }

  return <input type="text" {...commonProps} />;
};

const mapDefaultOptions = (options: AlgorithmOptionDefinition[]): Record<string, string> => {
  return options.reduce<Record<string, string>>((acc, option) => {
    acc[option.key] = String(option.defaultValue);
    return acc;
  }, {});
};

const formatInputExample = (example: unknown): string => formatJson(example);

const formatJson = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const buildOptionsPayload = (
  definitions: AlgorithmOptionDefinition[],
  values: Record<string, string>
): Record<string, number | string | boolean> => {
  const payload: Record<string, number | string | boolean> = {};
  for (const definition of definitions) {
    const rawValue = values[definition.key];
    if (rawValue === undefined || rawValue === '') {
      payload[definition.key] = definition.defaultValue;
      continue;
    }
    switch (definition.type) {
      case 'integer':
      case 'number':
        payload[definition.key] = Number(rawValue);
        break;
      case 'boolean':
        payload[definition.key] = rawValue === 'true' || rawValue === '1';
        break;
      default:
        payload[definition.key] = rawValue;
    }
  }
  return payload;
};

const safeReadError = async (response: Response): Promise<string> => {
  try {
    const payload = await response.json();
    if (payload && typeof payload === 'object' && 'message' in payload) {
      return String(payload.message);
    }
    return `Backend responded with status ${response.status}`;
  } catch {
    return `Backend responded with status ${response.status}`;
  }
};

export default App;

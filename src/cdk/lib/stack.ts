import { Stack, StackProps, RemovalPolicy, Duration, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Bucket, BlockPublicAccess } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { Runtime, FunctionUrlAuthType, HttpMethod } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Table, AttributeType, BillingMode } from 'aws-cdk-lib/aws-dynamodb';
import * as path from 'node:path';

export class AappLabStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // DynamoDB table is associated to store run of an algorithm
    // This allows for caching based on input data
    const table = new Table(this, 'RunsTable', {
      partitionKey: { name: 'id', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY
    });

    // Lambda backend with a Function URL
    // Can be enhanced with an API Gateway for improved routing
    const fn = new NodejsFunction(this, 'Backend', {
      entry: path.resolve(__dirname, '../../backend/handler.ts'),
      runtime: Runtime.NODEJS_20_X,
      memorySize: 256,
      timeout: Duration.seconds(10),
      environment: {
        TABLE_NAME: table.tableName
      }
    });
    table.grantReadWriteData(fn);

    const fnUrl = fn.addFunctionUrl({
      authType: FunctionUrlAuthType.NONE, // public for simplicity; restrict later if needed
      cors: {
        allowedOrigins: ['*'],
        allowedMethods: [HttpMethod.GET, HttpMethod.POST, HttpMethod.OPTIONS],
        allowedHeaders: ['*']
      }
    });

    // S3 website bucket
    const siteBucket = new Bucket(this, 'SiteBucket', {
      websiteIndexDocument: 'index.html',
      publicReadAccess: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ACLS,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true
    });

    // Deploy frontend build (from ../frontend/dist) to S3
    new BucketDeployment(this, 'DeployWebsite', {
      destinationBucket: siteBucket,
      sources: [
        Source.asset(path.resolve(__dirname, '../../frontend/dist')),
        Source.data(
          'runtime-config.js',
          [
            'window.__APP_CONFIG__ = Object.assign(window.__APP_CONFIG__ || {}, {',
            `  backendUrl: '${fnUrl.url}'`,
            '});',
            ''
          ].join('\n')
        )
      ]
    });

    new CfnOutput(this, 'WebsiteURL', { value: siteBucket.bucketWebsiteUrl });
    new CfnOutput(this, 'BackendURL', { value: fnUrl.url });
  }
}

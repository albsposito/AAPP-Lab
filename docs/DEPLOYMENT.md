# Deployment Guide

This document describes how to deploy the AAPP Lab application to AWS using the CDK.  The process assumes you are working within the repository root (`AAPP-Lab/`).

## 1. Prerequisites

Before deploying you will need the following tools installed locally:

- [Node.js 20.x](https://nodejs.org/en/download/) and npm
- [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html)
- [AWS CDK v2](https://docs.aws.amazon.com/cdk/v2/guide/work-with-cdk-typescript.html) (`npm install -g aws-cdk`)
- (Optional) [jq](https://stedolan.github.io/jq/) for pretty-printing JSON output

You will also need AWS credentials with permission to manage the following services in your AWS account:

- AWS CloudFormation
- AWS Lambda
- Amazon S3
- Amazon DynamoDB
- AWS Identity and Access Management (IAM)

For an AWS Free Tier account, create an IAM user with **Programmatic access** and attach either the `AdministratorAccess` policy (simplest for experimentation) or a custom policy that allows the services listed above.  Record the **Access key ID**, **Secret access key**, **Account ID**, and the **AWS Region** you plan to deploy into.

## 2. Configure AWS credentials

1. Open a terminal and configure the AWS CLI profile that the CDK will use:
   ```bash
   aws configure --profile aapp-lab
   ```
   Supply the Access key ID, Secret access key, chosen region (e.g. `us-east-1`), and your preferred default output format (`json` works well).
2. Export the profile for subsequent commands:
   ```bash
   export AWS_PROFILE=aapp-lab
   ```

If you are using temporary credentials from AWS SSO or another provider, ensure that `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and optionally `AWS_SESSION_TOKEN` are set in your environment before running CDK commands.

## 3. Install dependencies and build artifacts

Install packages and build the frontend + backend bundles.  These commands must be executed from the repository root:

```bash
# Backend dependencies
npm --prefix src/backend install

# Frontend dependencies and build output (creates src/frontend/dist)
npm --prefix src/frontend install
npm --prefix src/frontend run build

# CDK dependencies (TypeScript sources -> JavaScript)
npm --prefix src/cdk install
npm --prefix src/cdk run build
```

The CDK stack expects the frontend build artifacts to exist at `src/frontend/dist` when you deploy.  The `NodejsFunction` construct bundles the backend automatically during deployment.

## 4. Bootstrap the AWS environment (first time only)

If you have not deployed a CDK application to the target account/region combination before, bootstrap it.  Replace `123456789012` with your AWS account ID and `us-east-1` with your desired region.

```bash
npm --prefix src/cdk run bootstrap -- --profile $AWS_PROFILE aws://123456789012/us-east-1
```

You only need to run the bootstrap command once per account/region.  Subsequent deployments can skip this step.

## 5. Deploy the stack

Deploy the CDK stack to AWS:

```bash
npm --prefix src/cdk run deploy
```

You will be prompted to approve IAM resources on the first deployment.  Review the changes and respond with `y` to continue.

At the end of the deployment the CDK outputs two values:

- `WebsiteURL` – the public S3 website endpoint hosting the frontend
- `BackendURL` – the Lambda Function URL endpoint that serves API requests

Visit the `WebsiteURL` in your browser to load the application.  The frontend is configured to use the `BackendURL` automatically if you set the `VITE_API_BASE_URL` environment variable before building (see below).

## 6. Configure frontend API endpoint (optional)

By default, the frontend looks for the backend at `/api`.  When deploying to AWS you can bake the Function URL into the static site during the build:

```bash
VITE_API_BASE_URL="<FunctionUrlFromCdkOutputs>" npm --prefix src/frontend run build
```

Re-run the S3 deployment by executing `npm --prefix src/cdk run deploy` after rebuilding.

Alternatively, you can add a small client-side configuration file in the S3 bucket (e.g., `config.json`) and adjust the frontend to load it at runtime.

## 7. Cleaning up

To remove the deployed resources and avoid ongoing charges:

```bash
npm --prefix src/cdk run destroy
```

Confirm the prompt to delete the CloudFormation stack, Lambda function, DynamoDB table, and S3 bucket.

## Troubleshooting

- **Missing AWS credentials**: Ensure the CLI is configured and `AWS_PROFILE` or explicit environment variables are set.
- **Frontend deployment fails**: Confirm that `src/frontend/dist` exists before running `cdk deploy`.
- **CDK bootstrap errors**: Verify the account ID/region are correct and that the IAM user has permission to create CloudFormation and S3 resources.

If problems persist, capture the terminal output and reach out for assistance.

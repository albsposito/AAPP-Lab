import 'source-map-support/register';
import { App } from 'aws-cdk-lib';
import { AappLabStack } from '../lib/stack.js';

const app = new App();
new AappLabStack(app, 'AappLabStack', {});

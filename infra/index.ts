import * as pulumi from '@pulumi/pulumi';
import { loadRuntimeSecrets } from './config.js';

// Fail fast before touching the cluster if any vault secret is missing (Criterion #5).
const secrets = loadRuntimeSecrets();

const config = new pulumi.Config();
export const namespaceName = config.get('namespace') ?? 'marketplace';
export const configuredSecretsCount = Object.keys(secrets).length;

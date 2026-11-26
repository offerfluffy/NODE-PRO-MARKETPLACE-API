import * as k8s from '@pulumi/kubernetes';
import * as pulumi from '@pulumi/pulumi';
import { loadRuntimeSecrets } from './config.js';

// Fail fast before any cluster call if a required vault secret is missing (Criterion #5).
const secrets = loadRuntimeSecrets();

const config = new pulumi.Config();
const namespaceName = config.get('namespace') ?? 'marketplace';
const image = config.get('image') ?? 'marketplace-api:local';
const replicas = config.getNumber('replicas') ?? 3;
const rev = process.env.REV?.trim() || config.get('rev') || 'v1';
const warmupMs = config.getNumber('warmupMs') ?? 4000;
const drainMs = config.getNumber('drainMs') ?? 5000;
const nodePort = config.getNumber('nodePort') ?? 30080;

const appLabels = { app: 'marketplace-api' };

const toBase64Secret = (value: string): pulumi.Output<string> =>
  pulumi.secret(Buffer.from(value, 'utf8').toString('base64'));

// 1. Namespace
const ns = new k8s.core.v1.Namespace('marketplace-ns', {
  metadata: { name: namespaceName },
});

// 2. Runtime Secret (base64 `data`, not write-only `stringData`, for clean idempotency)
const runtimeSecret = new k8s.core.v1.Secret('marketplace-secrets', {
  metadata: {
    name: 'marketplace-secrets',
    namespace: ns.metadata.name,
  },
  type: 'Opaque',
  data: {
    APP_DB_PASSWORD: toBase64Secret(secrets.APP_DB_PASSWORD),
    JWT_PRIVATE_KEY: toBase64Secret(secrets.JWT_PRIVATE_KEY),
    JWT_PUBLIC_KEY: toBase64Secret(secrets.JWT_PUBLIC_KEY),
    JWT_KID: toBase64Secret(secrets.JWT_KID),
    REFRESH_TOKEN_PEPPER: toBase64Secret(secrets.REFRESH_TOKEN_PEPPER),
    STORAGE_ACCESS_KEY: toBase64Secret(secrets.STORAGE_ACCESS_KEY),
    STORAGE_SECRET_KEY: toBase64Secret(secrets.STORAGE_SECRET_KEY),
  },
});

// 3. Deployment (four zero-downtime settings + non-root numeric UID + secretKeyRef)
const deployment = new k8s.apps.v1.Deployment('marketplace-api', {
  metadata: {
    name: 'marketplace-api',
    namespace: ns.metadata.name,
    labels: appLabels,
  },
  spec: {
    // In local `kind` there is no metrics-server so HPA cannot scale;
    // in production with metrics-server, remove `replicas` or use ignoreChanges.
    replicas,
    selector: { matchLabels: appLabels },
    strategy: {
      type: 'RollingUpdate',
      rollingUpdate: {
        maxUnavailable: 0,
        maxSurge: 1,
      },
    },
    template: {
      metadata: { labels: appLabels },
      spec: {
        terminationGracePeriodSeconds: 20,
        securityContext: {
          runAsNonRoot: true,
          runAsUser: 65532,
          runAsGroup: 65532,
        },
        containers: [
          {
            name: 'api',
            image,
            imagePullPolicy: 'IfNotPresent',
            ports: [{ name: 'http', containerPort: 3000 }],
            env: [
              { name: 'K8S_STANDALONE', value: '1' },
              { name: 'PORT', value: '3000' },
              { name: 'REV', value: rev },
              { name: 'WARMUP_MS', value: String(warmupMs) },
              { name: 'DRAIN_MS', value: String(drainMs) },
              {
                name: 'APP_DB_PASSWORD',
                valueFrom: {
                  secretKeyRef: {
                    name: runtimeSecret.metadata.name,
                    key: 'APP_DB_PASSWORD',
                  },
                },
              },
            ],
            resources: {
              requests: { cpu: '50m', memory: '96Mi' },
              limits: { cpu: '250m', memory: '256Mi' },
            },
            readinessProbe: {
              httpGet: { path: '/readyz', port: 3000 },
              periodSeconds: 1,
              failureThreshold: 1,
              timeoutSeconds: 1,
            },
            livenessProbe: {
              httpGet: { path: '/healthz', port: 3000 },
              initialDelaySeconds: 15,
              periodSeconds: 10,
              failureThreshold: 3,
              timeoutSeconds: 1,
            },
          },
        ],
      },
    },
  },
});

// 4. Service (NodePort mapped to 127.0.0.1:28080 via k8s/kind-config.yaml)
const service = new k8s.core.v1.Service('marketplace-api-svc', {
  metadata: {
    name: 'marketplace-api',
    namespace: ns.metadata.name,
    labels: appLabels,
  },
  spec: {
    type: 'NodePort',
    selector: appLabels,
    ports: [
      {
        name: 'http',
        port: 80,
        targetPort: 3000,
        nodePort,
      },
    ],
  },
});

// 5. PodDisruptionBudget (minAvailable < replicas so maintenance/drain stays possible)
const pdb = new k8s.policy.v1.PodDisruptionBudget('marketplace-api-pdb', {
  metadata: {
    name: 'marketplace-api-pdb',
    namespace: ns.metadata.name,
  },
  spec: {
    minAvailable: 2,
    selector: { matchLabels: appLabels },
  },
});

// 6. HorizontalPodAutoscaler (autoscaling/v2, CPU utilization target)
const hpa = new k8s.autoscaling.v2.HorizontalPodAutoscaler('marketplace-api-hpa', {
  metadata: {
    name: 'marketplace-api-hpa',
    namespace: ns.metadata.name,
  },
  spec: {
    scaleTargetRef: {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      name: deployment.metadata.name,
    },
    minReplicas: 2,
    maxReplicas: 6,
    metrics: [
      {
        type: 'Resource',
        resource: {
          name: 'cpu',
          target: {
            type: 'Utilization',
            averageUtilization: 70,
          },
        },
      },
    ],
  },
});

export const namespace = ns.metadata.name;
export const deploymentName = deployment.metadata.name;
export const serviceName = service.metadata.name;
export const pdbName = pdb.metadata.name;
export const hpaName = hpa.metadata.name;
export const revision = rev;

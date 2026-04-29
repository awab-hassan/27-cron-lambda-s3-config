# Project # 27 - cron-lambda-s3-config

A serverless cron job runner. A single AWS Lambda is invoked every minute by EventBridge, fetches a job catalogue from S3, evaluates which jobs are due based on the current time, and executes them concurrently as HTTP calls. Add, update, or remove scheduled jobs by editing one JSON file in S3. No redeploys.

## How It Works

```
EventBridge rule (rate: 1 minute)
        |
        v
Lambda (Node.js 18.x / 20.x)
   1. Fetch s3://<bucket>/config.json via AWS SDK v3
   2. Parse jobs array
   3. For each job, evaluate shouldRunTask(job.interval) against current UTC time
   4. Execute eligible jobs concurrently via axios
   5. Log status codes to CloudWatch (payloads omitted)
```

### Interval Semantics

Each job declares a minute-based `interval`:

- `interval < 60` — fires when `currentMinute % interval === 0`
- `interval >= 60` — fires at the top of the hour when `currentHour % (interval / 60) === 0`

### Job Definition

Each job specifies `task`, an `api` block (`endpoint`, `method`, optional `headers` / `body` / `params`), and an `interval`. Any HTTP-callable API can be scheduled.

```json
[
  {
    "task": "sendReminderEmails",
    "api": {
      "endpoint": "https://api.example.com/v1/emails/reminders",
      "method": "POST",
      "headers": { "Content-Type": "application/json" },
      "body": { "subject": "Daily Reminder" }
    },
    "interval": 15
  },
  {
    "task": "checkSiteHealth",
    "api": {
      "endpoint": "https://example.com/api/health",
      "method": "GET",
      "params": { "verbose": "true" }
    },
    "interval": 60
  }
]
```

> Do not store API tokens in `config.json`. Inject them via Lambda environment variables or fetch them at runtime from AWS Secrets Manager.

## Stack

Node.js 18.x / 20.x (ES Modules) · `@aws-sdk/client-s3` (AWS SDK v3) · `axios` · AWS Lambda · EventBridge · S3

## Repository Layout

```
cron-lambda-s3-config/
├── index.mjs           # Lambda handler (ES modules, AWS SDK v3)
├── config.json         # Example job catalogue
├── .gitignore
└── README.md
```

## Prerequisites

- AWS account with access to Lambda, EventBridge, and S3
- Node.js 18+ for packaging
- An S3 bucket containing a valid `config.json`
- A Lambda execution role with:
  - `s3:GetObject` on the config object
  - `logs:CreateLogStream` and `logs:PutLogEvents`
  - KMS decrypt permissions if the bucket is encrypted with a customer-managed key

## Deployment

```bash
# Install dependencies
npm init -y
npm install axios @aws-sdk/client-s3

# Package
zip -r function.zip index.mjs node_modules package.json

# Create the function
aws lambda create-function \
  --function-name cron-runner \
  --runtime nodejs18.x \
  --handler index.handler \
  --role <lambda-execution-role-arn> \
  --zip-file fileb://function.zip

# Create the schedule
aws events put-rule \
  --name cron-runner-every-minute \
  --schedule-expression "rate(1 minute)"

# Wire the Lambda as the rule target
aws events put-targets \
  --rule cron-runner-every-minute \
  --targets '[{"Id":"1","Arn":"<lambda-arn>"}]'

# Allow EventBridge to invoke the Lambda
aws lambda add-permission \
  --function-name cron-runner \
  --statement-id allow-events \
  --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn <rule-arn>
```

## Testing

EventBridge delivers an empty event payload, which the handler ignores. To trigger a manual run:

```bash
aws lambda invoke --function-name cron-runner /dev/stdout
```

## Notes

- All scheduling evaluation runs in UTC. Account for this when defining intervals expected to align with local time.
- Lambda has a 15-minute timeout cap. Jobs that may run long should be moved to async workers (SQS + worker Lambda or ECS) rather than executed inline.
- Every invocation issues a fresh `GetObject` to S3. Acceptable at one-minute granularity; if invocation frequency increases, cache the config in module scope between warm starts.
- Sub-minute scheduling is not possible. EventBridge's minimum rate is 1 minute.
- Failures in concurrent jobs do not block siblings (`Promise.allSettled` is preferred over `Promise.all` for this; verify the handler matches before deploying).

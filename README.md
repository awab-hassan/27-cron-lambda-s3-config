# Cron Lambda — S3-driven Job Scheduler

A single AWS Lambda function, triggered every minute by EventBridge, that reads a list of jobs from an S3-hosted `config.json` and fires each one whose interval matches the current wall-clock minute. Used at **FanSocial** to centralise the catalogue of recurring HTTP tasks (reminder emails, site-health probes, etc.) so new jobs can be added by editing a single JSON file in S3 — no redeploy needed.

## Highlights

- **Config-as-data** — job definitions live as JSON in `s3://fansocial-configs/config.json`; add, remove, or change a job by uploading a new file. The Lambda picks it up on the next tick.
- **Flexible intervals** — each job declares an `interval` in minutes. If `< 60`, the job fires when `currentMinute % interval === 0`; if `≥ 60`, it fires once per hour at the top of the hour when `currentHour % (interval / 60) === 0`.
- **Generic HTTP runner** — each job specifies `method`, `endpoint`, `headers`, `body`, `params`; the Lambda calls it with `axios`. Any internal or third-party API becomes scheduleable.
- **Two runtime flavours side by side** — `old-index.js` uses CommonJS (`require`); `new-config.js` uses ES modules (`import`) for Node 18+ Lambda runtimes.
- **Single Lambda, unlimited jobs** — avoids the anti-pattern of one Lambda per cron — cheaper invocations, one log group, one dashboard.

## Architecture

```
 EventBridge rule (rate 1 minute)
              │
              ▼
 Lambda (Node.js 18)
   1. s3.getObject(s3://fansocial-configs/config.json)
   2. for each job in the array:
        if shouldRunTask(job.interval):
            axios(job.api.method, job.api.endpoint, ...)
   3. log result
```

## Tech stack

- **Runtime:** Node.js 18.x (ES modules) or Node 16+ (CommonJS variant)
- **Libraries:** `aws-sdk`, `axios`
- **AWS services:** Lambda, EventBridge (CloudWatch Events), S3
- **Config format:** JSON, hosted in S3

## Repository layout

```
CRON-LAMBDS/
├── README.md
├── .gitignore
├── new-config.js       # ES-modules handler (current)
├── old-index.js        # CommonJS handler (earlier version)
└── config.json         # Example of the jobs catalogue that lives in S3
```

## How it works

1. An EventBridge rule runs `rate(1 minute)` and invokes the Lambda.
2. The handler fetches `s3://fansocial-configs/config.json` and parses it as an array of job objects.
3. For each job, `shouldRunTask(job.interval)` decides whether this minute is a firing minute.
4. If so, `runTask(job)` builds an axios config from `job.api.method / endpoint / headers / body / params` and invokes the endpoint.
5. Results (success or failure) are logged to CloudWatch Logs.

### Example `config.json`

```json
[
  {
    "task": "sendEmail",
    "api": {
      "endpoint": "https://example.com/api/email",
      "method": "POST",
      "headers": { "Authorization": "...", "Content-Type": "application/json" },
      "body": { "subject": "Reminder Email" }
    },
    "interval": 15
  },
  {
    "task": "checkSiteHealth",
    "api": {
      "endpoint": "https://example.com/api/health",
      "method": "GET",
      "params": { "url": "https://example.com" }
    },
    "interval": 30
  }
]
```

## Prerequisites

- AWS account with Lambda, EventBridge, S3 access
- Node.js 18+ runtime (ES modules) or 16+ for the CommonJS version
- An S3 bucket named in the `S3_BUCKET` constant (default `fansocial-configs`) containing a `config.json` matching the schema above
- IAM role granting the Lambda:
  - `s3:GetObject` on `arn:aws:s3:::fansocial-configs/config.json`
  - `logs:CreateLogStream` / `logs:PutLogEvents`

## Setup & deploy

```bash
# Install deps before zipping
npm init -y
npm install aws-sdk axios

# Zip the handler
zip -r function.zip new-config.js node_modules package.json

# Deploy
aws lambda create-function \
  --function-name fansocial-cron-runner \
  --runtime nodejs18.x \
  --handler new-config.handler \
  --role <lambda-execution-role-arn> \
  --zip-file fileb://function.zip

# Schedule it every minute
aws events put-rule --name every-minute --schedule-expression "rate(1 minute)"
aws events put-targets --rule every-minute --targets '[{"Id":"1","Arn":"<lambda-arn>"}]'
aws lambda add-permission --function-name fansocial-cron-runner \
  --statement-id allow-events --action lambda:InvokeFunction \
  --principal events.amazonaws.com --source-arn <rule-arn>
```

## Example invocation

EventBridge delivers an empty event — the handler ignores it and loads everything from S3. To test locally:

```bash
aws lambda invoke --function-name fansocial-cron-runner /dev/stdout
```

## Notes

- The sample `config.json` contains an example Authorization header token — rotate it before any real deployment.
- To add a job, upload a new `config.json` to the S3 bucket; the Lambda picks it up on the next minute.
- Demonstrates: event-driven scheduling, S3 as configuration store, single-Lambda multiplexing, CommonJS→ESM migration path.

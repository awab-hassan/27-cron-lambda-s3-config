# Cron Lambda — S3-Driven Job Scheduler
A lightweight, serverless AWS Lambda function triggered every minute by EventBridge. It acts as a centralized job scheduler, dynamically fetching a configuration file (`config.json`) from Amazon S3 to execute recurring HTTP tasks (e.g., reminder emails, site-health probes, webhooks). 

By decoupling the job catalogue from the codebase, you can add, update, or remove scheduled jobs simply by modifying a JSON file in S3—**zero redeployments required.**

## 🚀 Highlights

- **Config-as-Data:** Job definitions live as JSON in `s3://etc-configs/config.json`. Upload a new file, and the Lambda picks up the changes on the next execution tick.
- **Concurrent Execution:** Built with modern async JavaScript. The Lambda fires all eligible tasks concurrently using `Promise.all()`, ensuring efficient execution and preventing timeout bloat.
- **Flexible Intervals:** Each job declares a minute-based `interval`. 
  - `< 60`: Fires when `currentMinute % interval === 0`.
  - `≥ 60`: Fires at the top of the hour when `currentHour % (interval / 60) === 0`.
- **Generic HTTP Runner:** Supports dynamic `method`, `endpoint`, `headers`, `body`, and `params`. Powered by `axios`, making any internal or third-party API scheduleable.
- **Single Lambda, Unlimited Jobs:** Avoids the anti-pattern of provisioning a separate Lambda function for every cron job. Reduces AWS costs, simplifies IAM, and centralizes logs into a single CloudWatch group.

## 🏗 Architecture

```text
 EventBridge Rule (rate: 1 minute)
              │
              ▼
 Lambda (Node.js 18.x / 20.x)
   1. Fetch s3://etc-configs/config.json using AWS SDK v3
   2. Parse jobs array
   3. Evaluate shouldRunTask(job.interval) for current time
   4. Execute all eligible jobs concurrently via Axios
   5. Log status codes to CloudWatch
```

## 🛠 Tech Stack

- **Runtime:** Node.js 18.x / 20.x (ES Modules)
- **Dependencies:** `@aws-sdk/client-s3` (AWS SDK v3), `axios`
- **Infrastructure:** AWS Lambda, Amazon EventBridge, Amazon S3
- **Configuration:** JSON array hosted in S3

## 📂 Repository Layout

```text
CRON-LAMBDA/
├── README.md
├── .gitignore
├── index.mjs           # Main Lambda handler (ES modules, AWS SDK v3)
└── config.json         # Example of the S3 job catalogue
```

## ⚙️ How It Works

1. An **EventBridge rule** invokes the Lambda function every 60 seconds.
2. The Lambda handler uses the S3Client to fetch and parse `s3://etc-configs/config.json`.
3. The function evaluates the schedule constraint for each job against the current wall-clock time.
4. Eligible jobs are queued as promises and executed concurrently via `axios`.
5. Success/failure statuses are logged to CloudWatch (payloads are omitted to prevent log bloat).

### Example `config.json`

```json
[
  {
    "task": "sendEmail",
    "api": {
      "endpoint": "https://api.example.com/v1/emails/reminders",
      "method": "POST",
      "headers": { 
        "Authorization": "Bearer YOUR_TOKEN_HERE", 
        "Content-Type": "application/json" 
      },
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

## 📋 Prerequisites

- AWS account with provisioning access to Lambda, EventBridge, and S3.
- Node.js 18+ installed locally for packaging.
- An S3 bucket (default: `etc-configs`) containing a valid `config.json`.
- An IAM Execution Role for the Lambda containing:
  - `s3:GetObject` on `arn:aws:s3:::etc-configs/config.json`
  - `logs:CreateLogStream` and `logs:PutLogEvents`
  - (Optional) AWS KMS permissions if the S3 bucket is encrypted.

## 🚀 Setup & Deploy
```bash
# Initialize and install modern dependencies
npm init -y
npm install axios @aws-sdk/client-s3

# Package the function
zip -r function.zip index.mjs node_modules package.json

# Deploy to AWS
aws lambda create-function \
  --function-name etc-cron-runner \
  --runtime nodejs18.x \
  --handler index.handler \
  --role <lambda-execution-role-arn> \
  --zip-file fileb://function.zip

# Create the EventBridge trigger
aws events put-rule \
  --name etc-every-minute \
  --schedule-expression "rate(1 minute)"

# Attach the Lambda to the trigger
aws events put-targets \
  --rule etc-every-minute \
  --targets '[{"Id":"1","Arn":"<lambda-arn>"}]'

# Grant EventBridge permissions to invoke the Lambda
aws lambda add-permission \
  --function-name etc-cron-runner \
  --statement-id allow-events \
  --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn <rule-arn>
```

## 🧪 Testing

EventBridge delivers an empty event payload which the handler naturally ignores. You can manually trigger a run to test S3 connectivity and API execution via the CLI:

```bash
aws lambda invoke --function-name etc-cron-runner /dev/stdout
```

## 📝 Important Notes

- **Secrets Management:** The example `config.json` shows hardcoded Authorization headers. For production, ensure API tokens are rotated regularly, or modify the Lambda to fetch sensitive headers dynamically from AWS Secrets Manager.
- **Timezones:** AWS Lambda executes in UTC time. Keep this in mind if you have daily intervals (e.g., `interval: 1440`) expecting execution at a specific local hour.
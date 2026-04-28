import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import axios from 'axios';

// S3 Client for SDK v3
const s3Client = new S3Client({ region: 'ap-northeast-1' });

// S3 bucket details
const S3_BUCKET = 'etc-configs';
const S3_KEY = 'config.json';

// Fetch the configuration file from S3 (config.json)
async function fetchConfigFromS3() {
    const params = {
        Bucket: S3_BUCKET,
        Key: S3_KEY
    };

    try {
        const command = new GetObjectCommand(params);
        const data = await s3Client.send(command);
        
        // SDK v3 way to read a stream to a string
        const bodyContents = await data.Body.transformToString(); 
        return JSON.parse(bodyContents);
    } catch (error) {
        console.error('Error fetching config from S3:', error);
        return [];
    }
}

// Check if the current time matches the job interval
function shouldRunTask(interval) {
    // Note: AWS Lambda executes in UTC time. 
    // If your intervals are hourly/minutely, UTC won't cause issues.
    const now = new Date(); 
    const minutes = now.getMinutes();
    const hours = now.getHours();

    if (interval < 60) {
        return minutes % interval === 0;
    }

    if (interval >= 60) {
        const hoursInterval = interval / 60;
        return hours % hoursInterval === 0 && minutes === 0;  // Run at the top of the hour
    }

    return false;
}

// Make the API call for each job
async function runTask(job) {
    try {
        const config = {
            method: job.api.method,
            url: job.api.endpoint,
            headers: job.api.headers,
            data: job.api.body || null,
            params: job.api.params || null
        };

        const response = await axios(config);
        // Logging only status to prevent CloudWatch log bloat from large payloads
        console.log(`${job.task} API call success, Status:`, response.status); 
    } catch (error) {
        console.error(`${job.task} API call failed:`, error.message);
    }
}

// Main function to handle jobs from config
async function handleJobs() {
    const config = await fetchConfigFromS3();
    const activeJobs = []; // Array to hold our running promises

    for (const job of config) {
        if (shouldRunTask(job.interval)) {
            console.log(`Queueing job: ${job.task}`);
            // Push the async task into the array without awaiting it yet
            activeJobs.push(runTask(job)); 
        } else {
            console.log(`Skipping job: ${job.task}, does not match interval`);
        }
    }

    // FIX: Wait for ALL queued API calls to finish concurrently before moving on.
    // This ensures Lambda doesn't shut down prematurely.
    await Promise.all(activeJobs);
}

// Lambda handler function triggered by EventBridge
export const handler = async (event) => {
    console.log('Lambda function triggered! Fetching jobs from S3...');
    await handleJobs();
    console.log('Job processing complete.');
};

// Note: To use this, make sure to package it first
// Run npm init -y in folder
// Run npm install axios @aws-sdk/client-s3
// Zip the entire folder (including node_modules, package.json, and index.mjs).
// Upload the .zip file to your AWS Lambda function. Ensure your Lambda runtime is set to Node.js 18.x or Node.js 20.x

require('dotenv').config();
const { Queue } = require('bullmq');

// Redis connection settings
const connection = {
  host: 'localhost',  // Replace with your Redis host if different
  port: 6379          // Replace with your Redis port if different
};

// Initialize the transaction queue
const transactionQueue = new Queue('transactionQueue', { connection });

module.exports = transactionQueue;

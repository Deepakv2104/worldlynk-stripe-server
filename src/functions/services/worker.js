require('dotenv').config();
const { Worker } = require('bullmq');
const transactionQueue = require('./transactionQueue');
const { db } = require('../config/firebase'); // Firestore setup

// Helper function to save transaction to Firestore
async function saveTransactionToFirestore(transactionData) {
  const transactionRef = db.collection('transactions').doc(transactionData.transactionId);
  await transactionRef.set(transactionData, { merge: true });
  console.log('Transaction successfully saved to Firestore on retry:', transactionData.transactionId);
}

// Worker that processes retry jobs from the queue
const worker = new Worker('transactionQueue', async (job) => {
  const { paymentIntentId, transactionData } = job.data;
  console.log(`Retrying save for PaymentIntent ID: ${paymentIntentId}`);

  try {
    await saveTransactionToFirestore(transactionData); // Retry saving
  } catch (error) {
    console.error(`Retry failed for PaymentIntent ID ${paymentIntentId}`, error);
    throw error; // Keeps the job in the queue for further retries
  }
}, { connection: { host: 'localhost', port: 6379 } });

// Log completed and failed jobs
worker.on('completed', (job) => {
  console.log(`Job ${job.id} completed successfully.`);
});

worker.on('failed', (job, err) => {
  console.log(`Job ${job.id} failed with error: ${err.message}`);
});

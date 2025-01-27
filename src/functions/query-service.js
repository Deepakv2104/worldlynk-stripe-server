const nodemailer = require('nodemailer');

// Simple rate limiting
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const requestCounts = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW;
  
  // Clean up old entries
  for (const [key, timestamp] of requestCounts) {
    if (timestamp < windowStart) requestCounts.delete(key);
  }
  
  // Check and update rate limit
  const count = requestCounts.get(ip) || 0;
  if (count >= 5) return true; // Max 5 requests per minute
  requestCounts.set(ip, now);
  return false;
}

function validateInput(data) {
  const required = ['personalInfo', 'category', 'selectedQuestions', 'status'];
  for (const field of required) {
    if (!data[field]) throw new Error(`Missing required field: ${field}`);
  }

  const { personalInfo } = data;
  if (!personalInfo.email || !personalInfo.name || !personalInfo.phone) {
    throw new Error('Missing required personal information');
  }

  if (!Array.isArray(data.selectedQuestions) || data.selectedQuestions.length === 0) {
    throw new Error('Selected questions must be a non-empty array');
  }
}

async function createEmailTransporter() {
  // Log environment variable presence for debugging
  console.log('Environment variables check:', {
    hasGmailUser: !!process.env.GMAIL_USER,
    hasGmailPass: !!process.env.GMAIL_APP_PASSWORD,
    hasDestEmail: !!process.env.DESTINATION_EMAIL
  });

  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD
    }
  });
}

function createEmailContent(data) {
  const formattedQuestions = data.selectedQuestions
    .map(q => `• ${q}`)
    .join('\n');

  return {
    from: `"${data.personalInfo.name}" <${process.env.GMAIL_USER}>`,
    to: process.env.DESTINATION_EMAIL,
    subject: `New Query - ${data.category.replace('-', ' ').toUpperCase()}`,
    text: `
Name: ${data.personalInfo.name}
Email: ${data.personalInfo.email}
Phone: ${data.personalInfo.phone}
Category: ${data.category.replace('-', ' ').toUpperCase()}
Status: ${data.status.toUpperCase()}
Timestamp: ${new Date().toLocaleString()}

Selected Questions:
${formattedQuestions}

Additional Details:
${data.additionalDetails || 'No additional details provided'}
    `,
    html: `
      <h2>New Query Submission</h2>
      <p><strong>Name:</strong> ${data.personalInfo.name}</p>
      <p><strong>Email:</strong> ${data.personalInfo.email}</p>
      <p><strong>Phone:</strong> ${data.personalInfo.phone}</p>
      <p><strong>Category:</strong> ${data.category.replace('-', ' ').toUpperCase()}</p>
      <p><strong>Status:</strong> ${data.status.toUpperCase()}</p>
      <p><strong>Timestamp:</strong> ${new Date().toLocaleString()}</p>
      
      <h3>Selected Questions:</h3>
      <ul>
        ${data.selectedQuestions.map(q => `<li>${q}</li>`).join('')}
      </ul>
      
      <h3>Additional Details:</h3>
      <p>${data.additionalDetails || 'No additional details provided'}</p>
    `
  };
}

// Test function for verifying email setup
async function testEmailSetup() {
  try {
    const transporter = await createEmailTransporter();
    const info = await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: process.env.DESTINATION_EMAIL,
      subject: "Test Email",
      text: "Email setup test"
    });
    console.log('Test email sent:', info.messageId);
    return true;
  } catch (error) {
    console.error('Test email failed:', error);
    return false;
  }
}

exports.handler = async function(event, context) {
  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      }
    };
  }

  // Special route for testing email setup
  if (event.path === '/.netlify/functions/query-service/test') {
    const testResult = await testEmailSetup();
    return {
      statusCode: testResult ? 200 : 500,
      body: JSON.stringify({
        message: testResult ? 'Email test successful' : 'Email test failed'
      }),
      headers: {
        'Content-Type': 'application/json'
      }
    };
  }

  if (event.httpMethod !== 'POST') {
    return { 
      statusCode: 405, 
      body: JSON.stringify({ error: 'Method Not Allowed' }),
      headers: { 'Content-Type': 'application/json' }
    };
  }

  // Rate limiting
  const clientIP = event.headers['client-ip'] || event.headers['x-forwarded-for'];
  if (isRateLimited(clientIP)) {
    return {
      statusCode: 429,
      body: JSON.stringify({ error: 'Too Many Requests' }),
      headers: { 'Content-Type': 'application/json' }
    };
  }

  try {
    const data = JSON.parse(event.body);
    validateInput(data);
    
    const transporter = await createEmailTransporter();
    const mailOptions = createEmailContent(data);
    
    await transporter.sendMail(mailOptions);

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Email sent successfully' }),
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      }
    };
  } catch (error) {
    console.error('Email sending failed:', error);
    const errorMessage = error?.message || 'An unknown error occurred';
    return {
      statusCode: errorMessage.includes('Missing required') ? 400 : 500,
      body: JSON.stringify({ 
        error: errorMessage
      }),
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      }
    };
  }
};
const QRCode = require('qrcode');

async function generateQRCodeUrl(qrData) {
  try {
    const qrDataString = JSON.stringify(qrData);
    const qrCodeUrl = await QRCode.toDataURL(qrDataString);
    console.log('QR Code URL generated successfully:', qrCodeUrl);
    return qrCodeUrl;
  } catch (error) {
    console.error('Error generating QR code:', error);
    throw new Error('Failed to generate QR code');
  }
}

module.exports = { generateQRCodeUrl };

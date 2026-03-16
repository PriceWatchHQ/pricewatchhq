/**
 * mailer.js — Email alerts via Resend
 */

import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.EMAIL_FROM || 'alerts@pricewatchhq.com';

/**
 * Send a price change alert email.
 */
export async function sendPriceAlert({ to, label, url, oldPrice, newPrice }) {
  const direction = newPrice < oldPrice ? 'dropped 📉' : 'increased 📈';
  const diff = Math.abs(newPrice - oldPrice).toFixed(2);
  const pct = (Math.abs(newPrice - oldPrice) / oldPrice * 100).toFixed(1);

  const subject = `Price ${direction} for ${label || url}`;
  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1a1a1a;">Price Alert 🔔</h2>
      <p>A price change was detected for <strong>${label || url}</strong>:</p>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr>
          <td style="padding: 12px; background: #f5f5f5; font-weight: bold;">Previous Price</td>
          <td style="padding: 12px; background: #f5f5f5;">$${oldPrice.toFixed(2)}</td>
        </tr>
        <tr>
          <td style="padding: 12px; font-weight: bold;">New Price</td>
          <td style="padding: 12px; color: ${newPrice < oldPrice ? '#16a34a' : '#dc2626'}; font-size: 1.2em; font-weight: bold;">
            $${newPrice.toFixed(2)} (${newPrice < oldPrice ? '-' : '+'}$${diff} / ${pct}%)
          </td>
        </tr>
      </table>
      <p><a href="${url}" style="color: #2563eb;">View product →</a></p>
      <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 30px 0;" />
      <p style="color: #666; font-size: 0.85em;">
        You're receiving this because you're monitoring this URL with PriceWatch HQ.<br/>
        <a href="https://pricewatchhq.com">pricewatchhq.com</a>
      </p>
    </div>
  `;

  await resend.emails.send({
    from: FROM,
    to,
    subject,
    html,
  });

  console.log(`[mailer] Alert sent to ${to} for ${label || url}`);
}

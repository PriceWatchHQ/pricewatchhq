/**
 * mailer.js — Email alerts via Resend
 */

import { Resend } from 'resend';

let _resend = null;
function getResend() {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}
const FROM = () => process.env.EMAIL_FROM || 'alerts@pricewatchhq.com';

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

  await getResend().emails.send({
    from: FROM(),
    to,
    subject,
    html,
  });

  console.log(`[mailer] Alert sent to ${to} for ${label || url}`);
}

/**
 * Send a welcome email to a new waitlist signup.
 */
export async function sendWelcomeEmail({ to }) {
  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; background: #0A0F1E; color: #E2E8F0; padding: 40px 32px; border-radius: 12px;">
      <h1 style="color: #4F8CFF; font-size: 1.6em; margin-bottom: 8px;">You're on the list. 🎉</h1>
      <p style="color: #94A3B8; margin-bottom: 24px;">Thanks for joining the PriceWatch HQ waitlist. We'll be in touch soon.</p>

      <div style="background: #121830; border-radius: 8px; padding: 24px; margin-bottom: 24px;">
        <h2 style="font-size: 1.1em; margin-bottom: 12px;">What is PriceWatch HQ?</h2>
        <p style="color: #94A3B8; line-height: 1.6;">
          We monitor your competitors' prices 24/7 and alert you the moment something changes —
          so you can react fast, protect your margins, and never get caught off guard.
        </p>
      </div>

      <div style="background: #121830; border-radius: 8px; padding: 24px; margin-bottom: 32px;">
        <h2 style="font-size: 1.1em; margin-bottom: 16px;">How it works:</h2>
        <ol style="color: #94A3B8; line-height: 2; padding-left: 20px;">
          <li>Add your competitor's product URLs</li>
          <li>We scrape them on your schedule</li>
          <li>Price changes? You get an instant alert</li>
          <li>Dashboard shows the full price history</li>
        </ol>
      </div>

      <p style="color: #94A3B8; margin-bottom: 24px;">
        We're launching soon with early access pricing for waitlist members. Stay tuned.
      </p>

      <a href="https://pricewatchhq.com" style="display: inline-block; background: #4F8CFF; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold;">
        Visit PriceWatch HQ →
      </a>

      <hr style="border: none; border-top: 1px solid #1E2740; margin: 32px 0;" />
      <p style="color: #4a5568; font-size: 0.8em;">
        You're receiving this because you signed up at pricewatchhq.com.
      </p>
    </div>
  `;

  await getResend().emails.send({
    from: FROM(),
    to,
    subject: "You're on the PriceWatch HQ waitlist 🎉",
    html,
  });

  console.log(`[mailer] Welcome email sent to ${to}`);
}

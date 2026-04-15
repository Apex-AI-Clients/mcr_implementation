import nodemailer from 'nodemailer'
import { renderMagicLinkEmail, renderReminderEmail } from './render'

function getTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  })
}

export async function sendMagicLinkEmail({
  to,
  clientName,
  portalUrl,
  expiresAt,
}: {
  to: string
  clientName: string
  portalUrl: string
  expiresAt: Date
}) {
  const transporter = getTransporter()

  await transporter.sendMail({
    from: `"MCR Partners" <${process.env.GMAIL_USER}>`,
    to,
    subject: 'MCR Partners — Your secure document portal is ready',
    html: renderMagicLinkEmail({ clientName, portalUrl, expiresAt }),
  })
}

export async function sendReminderEmail({
  to,
  clientName,
  portalUrl,
  missingItems,
}: {
  to: string
  clientName: string
  portalUrl: string
  missingItems: string[]
}) {
  const transporter = getTransporter()

  await transporter.sendMail({
    from: `"MCR Partners" <${process.env.GMAIL_USER}>`,
    to,
    subject: 'MCR Partners — Documents still needed',
    html: renderReminderEmail({ clientName, portalUrl, missingItems }),
  })
}

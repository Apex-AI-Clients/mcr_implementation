import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components'

interface ReminderEmailProps {
  clientName: string
  portalUrl: string
  missingItems: string[]
}

export function ReminderEmail({ clientName, portalUrl, missingItems }: ReminderEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>MCR Partners — a few more documents needed to complete your file</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          {/* Header */}
          <Section style={headerStyle}>
            <Heading style={logoStyle}>MCR Partners</Heading>
          </Section>

          <Section style={contentStyle}>
            <Heading style={h1Style}>A few more documents needed</Heading>

            <Text style={textStyle}>Hi {clientName.split(' ')[0]},</Text>

            <Text style={textStyle}>
              We are still waiting on a few documents to complete your file. To keep things moving,
              please upload the following as soon as possible:
            </Text>

            {/* Missing items list */}
            <Section style={listContainerStyle}>
              {missingItems.map((item, i) => (
                <Text key={i} style={listItemStyle}>
                  · {item}
                </Text>
              ))}
            </Section>

            <Section style={{ textAlign: 'center', margin: '28px 0' }}>
              <Button href={portalUrl} style={buttonStyle}>
                Upload Documents Now
              </Button>
            </Section>

            <Text style={noteStyle}>
              Your portal link is still active. If you are unsure what format a document should
              be in, your MCR Partners advisor can help.
            </Text>

            <Hr style={hrStyle} />

            <Text style={footerTextStyle}>
              If you have already uploaded these documents, our system may still be processing
              them — no action needed.
            </Text>

            <Text style={footerTextStyle}>
              MCR Partners · Debt Advisory · Australia
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

const bodyStyle = {
  backgroundColor: '#f4f4f5',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  margin: 0,
  padding: '40px 0',
}

const containerStyle = {
  maxWidth: '540px',
  margin: '0 auto',
  backgroundColor: '#ffffff',
  borderRadius: '12px',
  overflow: 'hidden',
}

const headerStyle = {
  backgroundColor: '#1A1A2E',
  padding: '24px 32px',
}

const logoStyle = {
  color: '#ffffff',
  fontSize: '20px',
  fontWeight: '700',
  margin: 0,
}

const contentStyle = {
  padding: '32px',
}

const h1Style = {
  color: '#1A1A2E',
  fontSize: '22px',
  fontWeight: '600',
  margin: '0 0 20px 0',
}

const textStyle = {
  color: '#374151',
  fontSize: '15px',
  lineHeight: '24px',
  margin: '0 0 16px 0',
}

const listContainerStyle = {
  backgroundColor: '#fef2f2',
  borderRadius: '8px',
  padding: '16px 20px',
  margin: '0 0 20px 0',
  borderLeft: '3px solid #E94560',
}

const listItemStyle = {
  color: '#1A1A2E',
  fontSize: '14px',
  lineHeight: '24px',
  margin: '2px 0',
  fontWeight: '500',
}

const buttonStyle = {
  backgroundColor: '#E94560',
  color: '#ffffff',
  fontSize: '15px',
  fontWeight: '600',
  padding: '14px 32px',
  borderRadius: '8px',
  textDecoration: 'none',
  display: 'inline-block',
}

const noteStyle = {
  color: '#6b7280',
  fontSize: '13px',
  lineHeight: '20px',
  margin: '0 0 16px 0',
}

const hrStyle = {
  borderColor: '#e5e7eb',
  margin: '24px 0',
}

const footerTextStyle = {
  color: '#9ca3af',
  fontSize: '12px',
  lineHeight: '18px',
  margin: '0 0 8px 0',
}

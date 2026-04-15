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

interface MagicLinkEmailProps {
  clientName: string
  portalUrl: string
  expiresAt: Date
}

export function MagicLinkEmail({ clientName, portalUrl, expiresAt }: MagicLinkEmailProps) {
  const expiryStr = expiresAt.toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  return (
    <Html>
      <Head />
      <Preview>MCR Partners — your secure document portal is ready</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          {/* Header */}
          <Section style={headerStyle}>
            <Heading style={logoStyle}>MCR Partners</Heading>
          </Section>

          <Section style={contentStyle}>
            <Heading style={h1Style}>Your document portal is ready</Heading>

            <Text style={textStyle}>Hi {clientName.split(' ')[0]},</Text>

            <Text style={textStyle}>
              Thank you for working with MCR Partners. To get started, please upload your
              financial documents through your secure, private portal using the button below.
            </Text>

            <Section style={{ textAlign: 'center', margin: '32px 0' }}>
              <Button href={portalUrl} style={buttonStyle}>
                Open My Document Portal
              </Button>
            </Section>

            <Text style={noteStyle}>
              This link is personal to you and expires on <strong>{expiryStr}</strong>. Please do
              not share it with anyone.
            </Text>

            <Hr style={hrStyle} />

            <Text style={footerTextStyle}>
              If you have questions about what documents are required, or need a new link, please
              contact your MCR Partners advisor directly.
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
  padding: '12px 16px',
  backgroundColor: '#f9fafb',
  borderRadius: '6px',
  borderLeft: '3px solid #E94560',
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

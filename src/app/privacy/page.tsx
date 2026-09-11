import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy — MCR Partners Pty Ltd',
  description:
    'How MCR Partners Pty Ltd (A.C.N 608 852 874) collects, uses, discloses and protects your Personal Information and Credit Information. Current as at 1 December 2018.',
}

/**
 * Verbatim transcription of docs/MCR-Partners-Privacy-Policy.pdf, the client's
 * own legal document. The numbering below is reproduced exactly as printed — it
 * jumps from 7 to 9, clause 14 carries no heading, sub-items 2 and 3 sit at the
 * outer indent, and the final two headings are bulleted rather than numbered.
 * Clause 9 ends mid-sentence in the source. Several run-on typos ("information.We
 * recognise", "your Personal Information" without a space) are in the PDF too.
 * None of this is a transcription error: do not "fix" any of it without a
 * signed-off replacement document from MCR.
 *
 * Public by design — outside the (app) route group and excluded from the proxy
 * matcher in src/proxy.ts so crawlers reach it unauthenticated.
 */

/** Numbered clause, with the hanging-indent number the PDF prints. */
function Clause({
  n,
  heading,
  headingTail,
  children,
}: {
  n: string
  heading?: string
  headingTail?: string
  children?: React.ReactNode
}) {
  return (
    <section className="grid grid-cols-[2.25rem_1fr] gap-x-2">
      <h2 className="contents text-base font-semibold">
        <span className="tabular-nums text-foreground/60">{n}</span>
        {/* headingTail carries its own leading space (or not) — clause 7 runs
            straight on from the heading's full stop, clause 13 does not. */}
        <span>
          {heading}
          {headingTail ? <span className="font-normal">{headingTail}</span> : null}
        </span>
      </h2>
      {children ? <div className="col-start-2 mt-2 space-y-4">{children}</div> : null}
    </section>
  )
}

/** Sub-numbered item inside clauses 13 and 14 (not bold in the source). */
function SubClause({
  n,
  heading,
  children,
}: {
  n: string
  heading: string
  children: React.ReactNode
}) {
  return (
    <section className="grid grid-cols-[1.75rem_1fr] gap-x-2">
      <h3 className="contents text-base">
        <span className="tabular-nums text-foreground/60">{n}</span>
        <span>{heading}</span>
      </h3>
      <div className="col-start-2 mt-2 space-y-4">{children}</div>
    </section>
  )
}

/** Unnumbered, bullet-marked heading — the last two headings in the source. */
function BulletClause({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="grid grid-cols-[2.25rem_1fr] gap-x-2">
      <h2 className="contents text-base font-semibold">
        <span aria-hidden="true" className="text-foreground/50">
          &bull;
        </span>
        <span>{heading}</span>
      </h2>
      <div className="col-start-2 mt-2 space-y-4">{children}</div>
    </section>
  )
}

export default function PrivacyPolicyPage() {
  return (
    <main className="px-6 py-16 sm:px-8 sm:py-24">
      <article className="mx-auto max-w-[65ch] text-[0.9375rem] leading-7 text-foreground/90">
        <header className="mb-12 border-b border-white/8 pb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            MCR PARTNERS PTY LTD PRIVACY POLICY{' '}
            <span className="mt-2 block text-lg font-normal text-foreground/70 sm:text-xl">
              (A.C.N 608 852 874)
            </span>
          </h1>
        </header>

        <p>
          This Privacy Policy outlines how we deal with your <em>Personal Information</em> (including
          credit-related information), as well as our legal obligations and rights as to that
          information. If we agree with you to use or disclose your <em>Personal Information</em> in
          different ways to those stated in this Privacy Policy, then in those circumstances this
          Policy is modified accordingly.
        </p>

        <div className="mt-10 space-y-10">
          <Clause n="1." heading="Our commitment to protect your privacy">
            <p>
              We understand how important it is to protect your <em>Personal Information</em>. This
              document sets out our Privacy Policy commitment in respect of{' '}
              <em>Personal Information</em> we hold about you and what we do with that
              information.We recognise that any <em>Personal Information</em> we collect about you
              will only be used for the purposes we have collected it for or as allowed under the
              law. It is important to us that you are confident that any{' '}
              <em>Personal Information</em> we hold about you will be treated in a way which ensures
              protection of your <em>Personal Information.</em>We abide by the Australian Privacy
              Principles for the protection of <em>Personal Information</em>, as set out in the
              Privacy Act and comply with the Credit Reporting Code made under that Act and also
              comply with other relevant laws.
            </p>
          </Clause>

          <Clause n="2." heading="Our Services and why we collect your Personal Information">
            <p>
              We act as a finance broker to assist you in sourcing a loan from a lender that suits
              your requirements. We gather information from you and submit it to lender/s to assist
              in finding you an appropriate loan. We assist you with paperwork associated with the
              loan application process. We will ask you to complete forms and other documents
              supplied by the lender/s as part of the loan application process. We may also collect
              your<em>Personal Information</em> for the purposes of direct marketing and managing our
              relationship with you.
            </p>
          </Clause>

          <Clause n="3." heading="What Personal Information we collect">
            <p>
              The type of information that we collect from you will depend on which loans, products
              and services you choose. Lenders we recommend and you choose will have their own
              privacy provisions relating to the protection of your privacy and you should review
              them. In particular, when you apply for a loan from a lender you will be given a
              detailed Lender&rsquo;s Privacy Consent Notice to read and sign.We may collect
              <em>Personal Information</em> (which includes <em>Credit Information</em>),{' '}
              <em>Credit Eligibility Information</em> and with your consent, Sensitive Information.
            </p>
            <p>
              <strong>Personal Information</strong> means information from which your identity is
              reasonably apparent (and includes, <em>Credit Information</em> and{' '}
              <em>Credit Eligibility Information</em>. Examples are:
            </p>
            <ul className="ml-5 list-[circle] space-y-2 marker:text-foreground/50">
              <li>
                identifying information, like your name, address and other contact details and your
                date of birth;
              </li>
              <li>
                information about your financial position, like your income, expenses, savings and
                assets and any (other) credit arrangements;
              </li>
              <li>your employment details;</li>
              <li>your tax file number;</li>
              <li>your reasons and objectives for applying for a product or service;</li>
            </ul>
            <p>
              and if you are applying for credit, other details such as the ages and number of your
              dependants and cohabitants, the length of time at your current address, and other
              information we consider relevant to preliminary assessment of your application and for
              submission to a lender.
            </p>
            <p>
              <strong>Credit Information</strong> includes:
            </p>
            <ul className="ml-5 list-[square] space-y-2 marker:text-foreground/50">
              <li>
                details of credit applied for and details of the type and amount of credit granted;
              </li>
              <li>the fact that credit provided to you has been repaid;</li>
              <li>whether or not you have made payments on time;</li>
              <li>
                default information, being payments overdue for at least 60 days and for which
                collection action has started, and
              </li>
              <li>information about your credit worthiness.</li>
            </ul>
            <p>
              <strong>Credit Eligibility Information</strong> refers to <em>Credit Information</em>{' '}
              received by us from a <em>Credit Reporting Body</em> and includes Credit Reporting
              Information.
            </p>
            <p>
              <strong>Credit-Related Information</strong> means <em>Credit Information</em> and{' '}
              <em>Credit Eligibility Information</em>.
            </p>
            <p>
              <strong>Sensitive information</strong> is <em>Personal Information</em> that includes
              information relating to your racial or ethnic origin, political persuasion, memberships
              in trade or professional associations or trade unions, sexual preferences, criminal
              record, or health records.
            </p>
          </Clause>

          <Clause n="4." heading="How we collect your Personal Information">
            <p>
              Where possible we will collect your Personal Information directly from you, but may
              also collect it from Credit Reporting Bodies and other people such as referees,
              employers, accountants, lawyers, financial advisers and financial counsellors.
            </p>
          </Clause>

          <Clause n="5." heading="How we use your Personal Information">
            <p>
              We may use your Personal Information (including Credit-Related Information) for the
              purposes of conducting a preliminary credit assessment of an application for credit by
              you, arranging for a lender to provide credit to you, providing you with products and
              services, managing our relationship with you and running our business. We may also use
              your Personal Information for other purposes where required or permitted by law.
            </p>
          </Clause>

          <Clause n="6." heading="Use of Your Personal Information for Direct Marketing Purposes">
            <p>
              We may also use <em>Personal Information</em> collected from you for direct marketing
              and in order to tell you about other products and services offered by us or by our
              business partners and may provide your details to other organisations for specific
              marketing purposes. We will consider that you consent to this use, unless you opt out.
              You may opt out at any time if you no longer wish to receive marketing information or
              do not wish to receive marketing information through a particular channel, like email.
              In order to do so, you will need to request that we no longer send marketing materials
              to you or disclose your information to other organisations for marketing purposes and
              may contact us by telephoning us on 03 8672 7989 or by writing to us to PO Box 2100,
              Gladstone Park VIC 3043. If the direct marketing is by email you may also use the
              unsubscribe function.
            </p>
          </Clause>

          {/* headingTail has no leading space: the source runs "Information.We may disclose". */}
          <Clause
            n="7."
            heading="How we disclose your Personal Information."
            headingTail="We may disclose your Personal Information to persons including:"
          >
            <ul className="ml-5 list-[circle] space-y-2 marker:text-foreground/50">
              <li>prospective lenders</li>
              <li>corporations which are related to us;</li>
              <li>
                a <em>Credit Reporting Body</em>;
              </li>
              <li>
                external service providers to us, such as organisations which we use to verify your
                identity, payment systems operators, mailing houses and research consultants;
              </li>
              <li>
                mortgage insurers, where lenders mortgage insurance in organised in respect to your
                credit;
              </li>
              <li>
                insurers and re-insurers, where insurance is provided in connection with our services
                to you;
              </li>
              <li>
                any industry body, tribunal, or court or otherwise in connection with any complaint
                regarding the services we provide to you;
              </li>
              <li>our professional advisors, such as accountants, lawyers and auditors;</li>
              <li>other credit providers and their professional advisors;</li>
              <li>your employer;</li>
              <li>the vendor of any goods you intend to purchase using any credit applied for;</li>
              <li>your representative, where authorised by you; or</li>
              <li>government and regulatory authorities, if required or authorised by law.</li>
            </ul>
          </Clause>

          <p>
            We also exchange your <em>Personal Information</em> with other organisations for the
            purposes of assisting you to make an application for credit.
          </p>

          <Clause n="9." heading="Security of your Personal Information">
            <p>
              We, our related corporations and our authorised agents hold your{' '}
              <em>Personal Information</em>. We take reasonable steps to ensure that your{' '}
              <em>Personal Information</em> held by us is protected from misuse, interference and
              loss, and from unauthorised access, disclosure or modification. Generally, we do not
              disclose your <em>Personal Information</em>
            </p>
          </Clause>

          <Clause n="10." heading="Notifiable matters">
            <p>
              Under the Credit Reporting Code we are required to ensure that you are aware of certain
              specified matters namely:
            </p>
            <ul className="ml-5 list-[circle] space-y-2 marker:text-foreground/50">
              <li>
                a <em>Credit Reporting Body</em> may include <em>Credit Information</em> in reports
                provided to us to assist us to assess your credit worthiness;
              </li>
              <li>
                you may find out about our policy in relation to management of credit related{' '}
                <em>Personal Information</em> by reading this Privacy Policy, reading our Privacy
                Consent Notice or contacting our Privacy Officer;
              </li>
              <li>
                you have a right to access your <em>Personal Information</em> held by us and to
                request that we correct the information and also have a right to make a complaint to
                us. See other sections of this Policy for further details;
              </li>
            </ul>
          </Clause>

          <Clause n="11." heading="Updating your Personal Information">
            <p>
              We take reasonable steps to make sure that the <em>Personal Information</em> (including{' '}
              <em>Credit Information</em>) that we collect, use or disclose is accurate, complete and
              up-to-date. It is important to us that <em>Personal Information</em> we hold about you
              is accurate and up to date. If you wish to make any changes to your{' '}
              <em>Personal Information</em>, please contact us.
            </p>
          </Clause>

          <Clause
            n="12."
            heading="Access and correction to your Personal Information and Credit Information"
          >
            <p>
              We will provide you with access to the <em>Personal Information</em> we hold about you
              on request. We may charge a fee for our costs of retrieving and supplying the
              information to you. Depending on the type of request you make we may respond to your
              request immediately. Otherwise, we will endeavour to respond to you within seven days
              of receiving your request. We may need to contact other entities to properly
              investigate your request.There may be situations where we are not required to provide
              you with access to your <em>Personal Information</em>, for example, if the information
              relates to existing or anticipated legal proceedings, or if your request is
              vexatious.An explanation will be provided to you, if we deny you access to the{' '}
              <em>Personal Information</em> (including <em>Credit Information</em>) we hold about
              you.
            </p>
          </Clause>

          <Clause
            n="13."
            heading="Privacy and our Website"
            headingTail=" When you deal with us via our website we collect additional Personal Information about you."
          >
            <SubClause n="1." heading="Public Pages">
              <p>
                Anytime you access an unsecured part of our website, that is, a public page which
                does not require you to log on, we will collect information about your visit, such
                as:
              </p>
              <ul className="ml-5 list-[square] space-y-2 marker:text-foreground/50">
                <li>the time and date of the visit;</li>
                <li>any information or documentation that you download;</li>
                <li>your browser type; and</li>
                <li>internet protocol details of the device used to access the site.</li>
              </ul>
            </SubClause>
          </Clause>

          <Clause n="14.">
            <SubClause n="1." heading="Cookies">
              <p>
                A &ldquo;cookie&rdquo; is a small text file which is placed on your internet browser
                and which we may access each time you visit our website. When you visit the secured
                pages of our website (i.e. pages that you have to provide login details to access) we
                use cookies for security and personalisation purposes. When you visit the unsecured
                pages of our website (i.e. public pages that you can access without providing login
                details) we use cookies to obtain information about how our website is being
                used.You may change the settings on your browser to reject cookies, however doing so
                might prevent you from accessing the secured pages of our website.
              </p>
            </SubClause>
          </Clause>

          <SubClause n="2." heading="Email">
            <p>
              When we receive emails, we will retain the content of the email and our response to you
              where we consider it necessary to do so.We may add your email address to our mailing
              lists.You may change the settings on your browser to reject cookies, however doing so
              might prevent you from accessing the secured pages of our website.
            </p>
          </SubClause>

          <SubClause n="3." heading="Third Party Websites">
            <p>
              Our website may contain links to third party websites. The terms of this Privacy Policy
              do not apply to external websites. If you wish to find out how any third parties handle
              your <em>Personal Information</em> or <em>Credit Information</em>, you will need to
              obtain a copy of their Privacy Policy.
            </p>
          </SubClause>

          <BulletClause heading="Changes to our Privacy Policy">
            <p>
              We may make changes to this Privacy Policy from time to time (without notice to you) to
              suit our business requirements or to comply with applicable laws. You may obtain a copy
              of our current Privacy Policy on this page or you can request a copy by contacting us.
            </p>
          </BulletClause>

          <BulletClause heading="Complaints and Questions">
            <p>
              If you have any questions, concerns or complaints about this Privacy Policy, or our
              handling of your <em>Personal Information</em> (including <em>Credit Information</em>),
              please contact our Privacy Officer specified below<em>.</em> You can also contact our
              Privacy Officer if you believe that the privacy of your <em>Personal Information</em>{' '}
              has been compromised or is not adequately protected.Once a question or complaint has
              been lodged, our Privacy Officer will respond to you as soon as possible. We will aim
              to deal with any complaints at the source of your complaint.If you are not satisfied
              with the response you receive, please let us know and we will investigate further and
              respond to you.If you are still not satisfied, you can contact external bodies that
              deal with privacy complaints. These are the Credit Ombudsman Service Limited, which is
              our external dispute resolution scheme or the Federal Privacy Commissioner. Either of
              these bodies may forward your complaint to another external dispute resolution body if
              it considers the complaint would be better handled by that other body.
            </p>
          </BulletClause>
        </div>

        <div className="mt-12 space-y-8 border-t border-white/8 pt-10">
          <address className="not-italic">
            <p className="font-semibold text-foreground">Federal Privacy Commissioner</p>
            <p>Post: GPO Box 5218 Sydney NSW 2001</p>
            <p>Telephone: 1300 363 992</p>
            <p>
              Website:{' '}
              <a
                href="https://www.oaic.gov.au"
                className="text-accent underline underline-offset-2 hover:opacity-80"
              >
                www.oaic.gov.au
              </a>
            </p>
          </address>

          <address className="not-italic">
            <p className="font-semibold text-foreground">
              Our Privacy Officer&rsquo;s contact details are:
            </p>
            <p>Address: PO Box 2100, Gladstone Park VIC 3043</p>
            <p>Telephone: 03 8672 7989</p>
            <p>
              Email:{' '}
              <a
                href="mailto:admin@mcrpartners.com.au"
                className="text-accent underline underline-offset-2 hover:opacity-80"
              >
                admin@mcrpartners.com.au
              </a>{' '}
              (marked to the attention of the Privacy Officer)
            </p>
          </address>
        </div>

        <p className="mt-12 border-t border-white/8 pt-8 text-foreground/70">
          This Privacy Policy is current as at 1 December 2018.
        </p>
      </article>
    </main>
  )
}

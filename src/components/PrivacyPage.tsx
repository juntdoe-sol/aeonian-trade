import { AppHeader } from './AppHeader';
import { BottomTabNav } from './BottomTabNav';
import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

export function PrivacyPage() {
  return (
    <div className='min-h-screen pb-24 text-white'>
      <AppHeader />

      <div className='px-4 pt-4 pb-4' style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <Link
          to='/portfolio'
          className='flex items-center gap-1 text-xs mb-3 transition-colors'
          style={{ color: '#8A8A8A' }}
        >
          <ChevronLeft size={14} />
          Back
        </Link>
        <h1 className='font-bold text-xl'>Privacy Policy</h1>
        <p className='text-xs mt-1' style={{ color: '#8A8A8A' }}>
          Last updated: June 2026
        </p>
      </div>

      <div className='px-4 pt-5 pb-8 space-y-6 text-sm leading-relaxed' style={{ color: '#CCCCCC' }}>
        <Section title='Overview'>
          <p style={{ color: '#8A8A8A' }}>
            AEONIAN is a non-custodial perpetual futures trading platform built on the Solana
            blockchain, with social rewards, an Arena for trading competitions, and a monthly
            on-chain prize pot. We are committed to protecting your privacy. This policy explains
            what information we collect, how we use it, and how we protect it.
          </p>
        </Section>

        <Divider />

        <Section title='Information We Collect'>
          <p style={{ color: '#8A8A8A' }}>
            Because AEONIAN is a non-custodial application, we do not collect or store private
            keys, seed phrases, or personal identifying information. We may collect:
          </p>
          <ul className='mt-3 space-y-2'>
            <Item>Public wallet addresses used to interact with the application</Item>
            <Item>
              Connected social account details (such as your public X handle and avatar) when you
              choose to link an account
            </Item>
            <Item>Aggregated, anonymized usage analytics to improve the experience</Item>
            <Item>Error and performance logs for debugging purposes</Item>
          </ul>
        </Section>

        <Divider />

        <Section title='Blockchain Data'>
          <p style={{ color: '#8A8A8A' }}>
            All on-chain transactions are publicly visible on the Solana blockchain. We do not
            control or have access to your private keys. By using a non-custodial wallet, you are
            solely responsible for the security of your private keys and seed phrases.
          </p>
        </Section>

        <Divider />

        <Section title='Third-Party Services'>
          <p style={{ color: '#8A8A8A' }}>
            AEONIAN relies on third-party infrastructure to operate, including Solana RPC providers,
            wallet and login providers, and the on-chain trading venues your orders are routed to
            for execution. Each of these services has its own privacy policy, and we recommend
            reviewing them before use.
          </p>
        </Section>

        <Divider />

        <Section title='Cookies & Storage'>
          <p style={{ color: '#8A8A8A' }}>
            We use browser local storage to persist your preferences and session data. We do not
            use third-party tracking cookies. You may clear local storage at any time through your
            browser settings.
          </p>
        </Section>

        <Divider />

        <Section title='Data Retention'>
          <p style={{ color: '#8A8A8A' }}>
            We retain server logs for up to 30 days for security and debugging purposes. Anonymized
            analytics data may be retained for longer periods to track product improvements over
            time.
          </p>
        </Section>

        <Divider />

        <Section title='Your Rights'>
          <p style={{ color: '#8A8A8A' }}>
            Depending on your jurisdiction, you may have rights including access to your data,
            correction of inaccurate data, deletion of your data, and the right to object to
            certain processing. Contact us to exercise these rights.
          </p>
        </Section>

        <Divider />

        <Section title='Contact'>
          <p style={{ color: '#8A8A8A' }}>
            For privacy-related questions or requests, please contact us through the AEONIAN
            official support channels.
          </p>
        </Section>
      </div>

      <BottomTabNav />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className='font-semibold text-base mb-2' style={{ color: '#b794f6' }}>
        {title}
      </h2>
      {children}
    </div>
  );
}

function Divider() {
  return <div className='border-t' style={{ borderColor: '#1F1F1F' }} />;
}

function Item({ children }: { children: React.ReactNode }) {
  return (
    <li className='flex items-start gap-2 list-none' style={{ color: '#8A8A8A' }}>
      <span className='mt-1.5 w-1 h-1 rounded-full flex-shrink-0' style={{ background: '#b794f6' }} />
      <span>{children}</span>
    </li>
  );
}

export default PrivacyPage;

import { AppHeader } from './AppHeader';
import { BottomTabNav } from './BottomTabNav';
import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

export function CopyrightPage() {
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
        <h1 className='font-bold text-xl'>Copyright</h1>
        <p className='text-xs mt-1' style={{ color: '#8A8A8A' }}>
          Last updated: June 2026
        </p>
      </div>

      <div className='px-4 pt-5 pb-8 space-y-6 text-sm leading-relaxed' style={{ color: '#CCCCCC' }}>
        <Section title='Ownership'>
          <p style={{ color: '#8A8A8A' }}>
            All content, design, code, logos, graphics, and materials on AEONIAN are the exclusive
            intellectual property of AEONIAN and its licensors. Copyright &copy;{' '}
            {new Date().getFullYear()} AEONIAN. All rights reserved.
          </p>
        </Section>

        <Divider />

        <Section title='Permitted Use'>
          <p style={{ color: '#8A8A8A' }}>
            You are granted a limited, non-exclusive, non-transferable license to access and use
            the AEONIAN application for your personal, non-commercial use. This license does not
            include any right to:
          </p>
          <ul className='mt-3 space-y-2' style={{ color: '#8A8A8A' }}>
            <Item>Modify, copy, or distribute any content from this application</Item>
            <Item>Use any data mining, robots, or similar data gathering tools</Item>
            <Item>Frame or mirror any part of this application</Item>
            <Item>Reverse engineer or decompile any portion of the software</Item>
          </ul>
        </Section>

        <Divider />

        <Section title='Trademarks'>
          <p style={{ color: '#8A8A8A' }}>
            &ldquo;AEONIAN&rdquo; and the AEONIAN logo are trademarks or registered trademarks. No
            license or right to use any trademark is granted to you by virtue of accessing or using
            this application.
          </p>
        </Section>

        <Divider />

        <Section title='Third-Party Content'>
          <p style={{ color: '#8A8A8A' }}>
            Market data, pricing, and on-chain transaction data are sourced from underlying
            on-chain trading venues and public Solana blockchain infrastructure. AEONIAN makes no
            claim of ownership over such third-party content and presents it for informational
            purposes only.
          </p>
        </Section>

        <Divider />

        <Section title='DMCA & Takedown Policy'>
          <p style={{ color: '#8A8A8A' }}>
            If you believe that any content on this platform infringes your intellectual property
            rights, please contact us with a detailed description of the alleged infringement and
            your contact information. We will respond promptly in accordance with applicable law.
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
    <li className='flex items-start gap-2 list-none'>
      <span className='mt-1.5 w-1 h-1 rounded-full flex-shrink-0' style={{ background: '#b794f6' }} />
      <span>{children}</span>
    </li>
  );
}

export default CopyrightPage;

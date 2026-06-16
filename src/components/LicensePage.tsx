import { AppHeader } from './AppHeader';
import { BottomTabNav } from './BottomTabNav';
import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

export function LicensePage() {
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
        <h1 className='font-bold text-xl'>License</h1>
        <p className='text-xs mt-1' style={{ color: '#8A8A8A' }}>
          Last updated: May 2025
        </p>
      </div>

      <div className='px-4 pt-5 pb-8 space-y-6 text-sm leading-relaxed' style={{ color: '#CCCCCC' }}>
        <Section title='MIT License'>
          <p>
            Copyright &copy; {new Date().getFullYear()} AEONIAN. All rights reserved.
          </p>
          <p className='mt-3' style={{ color: '#8A8A8A' }}>
            Permission is hereby granted, free of charge, to any person obtaining a copy of this
            software and associated documentation files (the &ldquo;Software&rdquo;), to deal in
            the Software without restriction, including without limitation the rights to use, copy,
            modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
            to permit persons to whom the Software is furnished to do so, subject to the following
            conditions:
          </p>
          <p className='mt-3' style={{ color: '#8A8A8A' }}>
            The above copyright notice and this permission notice shall be included in all copies or
            substantial portions of the Software.
          </p>
        </Section>

        <Divider />

        <Section title='Disclaimer of Warranties'>
          <p style={{ color: '#8A8A8A' }}>
            THE SOFTWARE IS PROVIDED &ldquo;AS IS&rdquo;, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
            IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
            PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
            HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
            CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR
            THE USE OR OTHER DEALINGS IN THE SOFTWARE.
          </p>
        </Section>

        <Divider />

        <Section title='Third-Party Licenses'>
          <p style={{ color: '#8A8A8A' }}>
            This application uses open-source libraries and components, each governed by their
            respective licenses. Notable dependencies include React (MIT), Solana web3.js (Apache
            2.0), and Phoenix Exchange SDK. Full third-party license notices are available upon
            request.
          </p>
        </Section>

        <Divider />

        <Section title='Contact'>
          <p style={{ color: '#8A8A8A' }}>
            For licensing inquiries, please contact us via the Phoenix Exchange official channels or
            through the application&apos;s support resources.
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

export default LicensePage;

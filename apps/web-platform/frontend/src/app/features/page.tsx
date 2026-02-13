'use client';

import { useRouter } from 'next/navigation';

const features = [
  {
    icon: '🔍',
    title: 'Unified Search',
    desc: 'Search filings from Korea and Hong Kong listed companies in one place. Quickly find by company name, stock code, or keywords.',
  },
  {
    icon: '📊',
    title: 'Smart Table Extraction',
    desc: 'Automatically extract financial tables from PDF and HTML documents. Export to Excel with one click.',
  },
  {
    icon: '🌏',
    title: 'Multi-Language Support',
    desc: 'Seamlessly handle Korean, English, and Chinese documents. Search engine optimized for Asian markets.',
  },
  {
    icon: '⚡',
    title: 'Real-time Sync',
    desc: 'New filings from DART and HKEX are automatically synced to our database as they are published.',
  },
  {
    icon: '📱',
    title: 'Responsive Design',
    desc: 'Optimized experience on desktop, tablet, and mobile devices.',
  },
  {
    icon: '🔒',
    title: 'Security & Compliance',
    desc: 'Enterprise-grade security to keep your data safe. SOC 2 Type II certification in progress.',
  },
];

const upcomingFeatures = [
  {
    icon: '🤖',
    title: 'AI Document Analysis',
    desc: 'GPT-powered document summarization and key information extraction coming soon.',
  },
  {
    icon: '🔔',
    title: 'Alert Service',
    desc: 'Get notified via email or Slack when your watchlist companies publish new filings.',
  },
  {
    icon: '📈',
    title: 'Financial Comparison Tools',
    desc: 'Compare and analyze financial data across multiple companies at a glance.',
  },
];

export default function FeaturesPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-stone-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Hero Section */}
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-5xl font-bold text-neutral-900 mb-4">
            Features
          </h1>
          <p className="text-xl text-neutral-600 max-w-2xl mx-auto">
            Asian filing analysis platform built for institutional investors
          </p>
        </div>

        {/* Main Features Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-16">
          {features.map((feature, index) => (
            <div
              key={index}
              className="bg-white rounded-2xl p-6 shadow-elevated border border-primary-100 hover:shadow-strong hover:-translate-y-1 transition-all duration-300"
            >
              <div className="text-4xl mb-4">{feature.icon}</div>
              <h3 className="text-xl font-bold text-neutral-900 mb-2">
                {feature.title}
              </h3>
              <p className="text-neutral-600">
                {feature.desc}
              </p>
            </div>
          ))}
        </div>

        {/* Coming Soon Section */}
        <div className="bg-gradient-to-br from-primary-500 via-primary-600 to-secondary-600 rounded-3xl p-8 md:p-12 mb-16">
          <h2 className="text-2xl md:text-3xl font-bold text-white text-center mb-8">
            Coming Soon
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {upcomingFeatures.map((feature, index) => (
              <div
                key={index}
                className="bg-white/10 backdrop-blur-sm rounded-xl p-6 border border-white/20"
              >
                <div className="text-3xl mb-3">{feature.icon}</div>
                <h3 className="text-lg font-bold text-white mb-2">
                  {feature.title}
                </h3>
                <p className="text-primary-100 text-sm">
                  {feature.desc}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* CTA Section */}
        <div className="text-center">
          <h2 className="text-2xl font-bold text-neutral-900 mb-4">
            Get Started Today
          </h2>
          <p className="text-neutral-600 mb-6">
            Experience AsiaFilings with a free trial.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button
              onClick={() => router.push('/pricing')}
              className="px-8 py-3 bg-gradient-to-r from-primary-600 to-primary-700 text-white font-bold rounded-xl shadow-medium hover:shadow-strong hover:-translate-y-0.5 transition-all duration-200"
            >
              View Pricing
            </button>
            <button
              onClick={() => router.push('/contact')}
              className="px-8 py-3 bg-white text-primary-700 font-bold rounded-xl border-2 border-primary-200 hover:border-primary-400 shadow-soft hover:shadow-medium transition-all duration-200"
            >
              Contact Us
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

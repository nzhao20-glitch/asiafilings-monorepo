'use client';

import { useRouter } from 'next/navigation';

const pricingTiers = [
  {
    name: 'Starter',
    price: 'Free',
    period: '',
    desc: 'Basic features for individual investors',
    features: [
      '100 filings per month',
      'Basic search functionality',
      'Korea market (DART)',
      'Email support',
    ],
    cta: 'Start Free',
    highlighted: false,
  },
  {
    name: 'Professional',
    price: '$79',
    period: '/month',
    desc: 'For professional investors and analysts',
    features: [
      'Unlimited filing access',
      'Advanced search & filters',
      'Korea + Hong Kong markets',
      'Table export to Excel',
      'API access (10,000/month)',
      'Priority email support',
    ],
    cta: 'Start Pro',
    highlighted: true,
  },
  {
    name: 'Enterprise',
    price: 'Contact Us',
    period: '',
    desc: 'Custom solutions for large institutions',
    features: [
      'Everything in Pro',
      'All 5 Asian markets',
      'Unlimited API access',
      'AI document analysis (beta)',
      'Custom alert configurations',
      'Dedicated account manager',
      'SSO & SAML support',
      'SLA guarantee',
    ],
    cta: 'Contact Sales',
    highlighted: false,
  },
];

const faqs = [
  {
    question: 'Is there a free trial?',
    answer: 'The Starter plan is free forever. Pro plan includes a 14-day free trial before billing begins.',
  },
  {
    question: 'Can I cancel anytime?',
    answer: 'Yes, monthly subscriptions can be cancelled anytime. You will have access until the end of your billing cycle.',
  },
  {
    question: 'What payment methods do you accept?',
    answer: 'We accept credit cards (Visa, Mastercard, Amex), PayPal, and wire transfer for enterprise customers.',
  },
  {
    question: 'Do you offer team pricing?',
    answer: 'Enterprise plan offers team and organization-wide licensing. Please contact our sales team.',
  },
];

export default function PricingPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-stone-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Hero Section */}
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold text-neutral-900 mb-4">
            Pricing
          </h1>
          <p className="text-xl text-neutral-600 max-w-2xl mx-auto">
            Choose the plan that fits your needs. Upgrade or downgrade anytime.
          </p>
        </div>

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
          {pricingTiers.map((tier, index) => (
            <div
              key={index}
              className={`rounded-2xl p-6 ${
                tier.highlighted
                  ? 'bg-gradient-to-br from-primary-500 via-primary-600 to-secondary-600 text-white shadow-strong scale-105'
                  : 'bg-white border border-primary-100 shadow-elevated'
              } hover:shadow-strong transition-all duration-300`}
            >
              {tier.highlighted && (
                <div className="text-xs font-bold bg-white/20 text-white px-3 py-1 rounded-full inline-block mb-4">
                  Most Popular
                </div>
              )}
              <h3 className={`text-2xl font-bold mb-2 ${tier.highlighted ? 'text-white' : 'text-neutral-900'}`}>
                {tier.name}
              </h3>
              <div className="mb-4">
                <span className={`text-4xl font-bold ${tier.highlighted ? 'text-white' : 'text-primary-700'}`}>
                  {tier.price}
                </span>
                <span className={tier.highlighted ? 'text-primary-100' : 'text-neutral-500'}>
                  {tier.period}
                </span>
              </div>
              <p className={`mb-6 ${tier.highlighted ? 'text-primary-100' : 'text-neutral-600'}`}>
                {tier.desc}
              </p>
              <ul className="space-y-3 mb-8">
                {tier.features.map((feature, fIndex) => (
                  <li key={fIndex} className="flex items-start gap-2">
                    <svg
                      className={`w-5 h-5 flex-shrink-0 mt-0.5 ${tier.highlighted ? 'text-white' : 'text-primary-600'}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className={tier.highlighted ? 'text-white' : 'text-neutral-700'}>
                      {feature}
                    </span>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => router.push('/contact')}
                className={`w-full py-3 rounded-xl font-bold transition-all duration-200 ${
                  tier.highlighted
                    ? 'bg-white text-primary-700 hover:bg-primary-50'
                    : 'bg-gradient-to-r from-primary-600 to-primary-700 text-white hover:from-primary-700 hover:to-primary-800'
                } shadow-medium hover:shadow-strong`}
              >
                {tier.cta}
              </button>
            </div>
          ))}
        </div>

        {/* FAQ Section */}
        <div className="bg-white rounded-2xl p-8 shadow-elevated border border-primary-100">
          <h2 className="text-2xl font-bold text-neutral-900 text-center mb-8">
            Frequently Asked Questions
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {faqs.map((faq, index) => (
              <div key={index} className="bg-neutral-50 rounded-xl p-5">
                <h3 className="font-bold text-neutral-900 mb-2">
                  {faq.question}
                </h3>
                <p className="text-neutral-600 text-sm">
                  {faq.answer}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Contact CTA */}
        <div className="text-center mt-12">
          <p className="text-neutral-600 mb-4">
            Have more questions?
          </p>
          <button
            onClick={() => router.push('/contact')}
            className="px-6 py-2 text-primary-700 font-medium hover:text-primary-800 underline underline-offset-4"
          >
            Contact Us
          </button>
        </div>
      </div>
    </div>
  );
}

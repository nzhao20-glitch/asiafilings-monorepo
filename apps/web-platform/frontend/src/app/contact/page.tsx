'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ContactPage() {
  const router = useRouter();

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    subject: '',
    message: '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    alert('Thank you! Your message has been sent. (This is a demo page)');
    setFormData({ name: '', email: '', subject: '', message: '' });
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  return (
    <div className="min-h-screen bg-stone-100">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Back Button */}
        <button
          onClick={() => router.back()}
          className="mb-8 inline-flex items-center gap-2 text-primary-700 hover:text-primary-800 font-semibold transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>

        {/* Header */}
        <div className="text-center mb-12 bg-gradient-to-br from-primary-500 via-primary-600 to-secondary-600 rounded-3xl p-12 shadow-strong">
          <div>
            <h1 className="text-5xl font-bold text-white mb-4 drop-shadow-lg">
              Contact Us
            </h1>
            <p className="text-xl text-primary-50">
              Have questions or feedback? We'd love to hear from you
            </p>
          </div>
        </div>

        {/* Contact Form */}
        <div className="bg-white rounded-2xl shadow-elevated border border-primary-200 p-8 md:p-10 mb-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Name */}
            <div>
              <label htmlFor="name" className="block text-sm font-bold text-neutral-900 mb-2">
                Name <span className="text-primary-600">*</span>
              </label>
              <input
                type="text"
                id="name"
                name="name"
                required
                value={formData.name}
                onChange={handleChange}
                className="w-full px-4 py-3 border-2 border-primary-200 rounded-xl shadow-inner-soft focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-primary-400 focus:shadow-glow-blue transition-all duration-200"
                placeholder="John Doe"
              />
            </div>

            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-bold text-neutral-900 mb-2">
                Email <span className="text-primary-600">*</span>
              </label>
              <input
                type="email"
                id="email"
                name="email"
                required
                value={formData.email}
                onChange={handleChange}
                className="w-full px-4 py-3 border-2 border-primary-200 rounded-xl shadow-inner-soft focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-primary-400 focus:shadow-glow-blue transition-all duration-200"
                placeholder="example@email.com"
              />
            </div>

            {/* Subject */}
            <div>
              <label htmlFor="subject" className="block text-sm font-bold text-neutral-900 mb-2">
                Subject <span className="text-primary-600">*</span>
              </label>
              <input
                type="text"
                id="subject"
                name="subject"
                required
                value={formData.subject}
                onChange={handleChange}
                className="w-full px-4 py-3 border-2 border-primary-200 rounded-xl shadow-inner-soft focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-primary-400 focus:shadow-glow-blue transition-all duration-200"
                placeholder="Enter your subject"
              />
            </div>

            {/* Message */}
            <div>
              <label htmlFor="message" className="block text-sm font-bold text-neutral-900 mb-2">
                Message <span className="text-primary-600">*</span>
              </label>
              <textarea
                id="message"
                name="message"
                required
                value={formData.message}
                onChange={handleChange}
                rows={6}
                className="w-full px-4 py-3 border-2 border-primary-200 rounded-xl shadow-inner-soft focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-primary-400 focus:shadow-glow-blue transition-all duration-200 resize-none"
                placeholder="Please describe your inquiry in detail..."
              />
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              className="w-full bg-gradient-to-r from-primary-500 to-secondary-500 text-white py-4 rounded-xl font-bold text-lg shadow-medium hover:shadow-elevated hover:from-primary-600 hover:to-secondary-600 active:scale-[0.98] transition-all duration-200"
            >
              Send Message
            </button>
          </form>
        </div>

        {/* Contact Info Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-blue-50 rounded-xl p-6 border border-primary-200 shadow-medium text-center">
            <div className="w-12 h-12 bg-gradient-to-br from-primary-500 to-primary-600 rounded-xl flex items-center justify-center mx-auto mb-4 shadow-medium">
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 className="font-bold text-primary-900 mb-2">Email</h3>
            <p className="text-sm text-neutral-700">contact@asiafilings.com</p>
          </div>

          <div className="bg-blue-50 rounded-xl p-6 border border-secondary-200 shadow-medium text-center">
            <div className="w-12 h-12 bg-gradient-to-br from-secondary-500 to-secondary-600 rounded-xl flex items-center justify-center mx-auto mb-4 shadow-medium">
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
            </div>
            <h3 className="font-bold text-secondary-900 mb-2">Phone</h3>
            <p className="text-sm text-neutral-700">+852-1234-5678</p>
          </div>

          <div className="bg-blue-50 rounded-xl p-6 border border-accent-200 shadow-medium text-center">
            <div className="w-12 h-12 bg-gradient-to-br from-accent-500 to-accent-600 rounded-xl flex items-center justify-center mx-auto mb-4 shadow-medium">
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <h3 className="font-bold text-accent-900 mb-2">Address</h3>
            <p className="text-sm text-neutral-700">Central, Hong Kong</p>
          </div>
        </div>
      </div>
    </div>
  );
}

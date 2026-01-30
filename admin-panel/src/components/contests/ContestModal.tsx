'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { X, Loader2, Calendar, Shield, Cpu, Clock, Settings, FileText } from 'lucide-react';
import type { ContestData } from '@/app/actions/contests';
import { apiClient } from '@/lib/apiClient';
import { contests } from '@prisma/client';
import { PROGRAMMING_LANGUAGES } from '@/lib/constants';
import { useToast } from '@/components/providers/ToastProvider';

interface ContestModalProps {
  isOpen: boolean;
  onClose: () => void;
  contest?: contests | null;
  onSuccess: () => void;
}

const formatDateForInput = (date: Date | string | undefined) => {
    if (!date) return '';
  const d = new Date(date);
    const pad = (n: number) => n < 10 ? '0' + n : n;
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

type Tab = 'general' | 'access' | 'tokens' | 'limits' | 'analysis';

export function ContestModal({ isOpen, onClose, contest, onSuccess }: ContestModalProps) {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('general');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    start: '',
    stop: '',
    timezone: 'Asia/Bangkok',
    languages: [] as string[],
    submissions_download_allowed: true,
    allow_questions: true,
    allow_user_tests: false,
    allow_unofficial_submission_before_analysis_mode: false,
    block_hidden_participations: false,
    allow_password_authentication: true,
    allow_registration: false,
    ip_restriction: false,
    ip_autologin: false,
    token_mode: 'disabled',
    token_max_number: 0,
    token_min_interval: 0, // seconds
    token_gen_initial: 0,
    token_gen_number: 0,
    token_gen_interval: 30, // minutes
    token_gen_max: 0,
    max_submission_number: 0,
    max_user_test_number: 0,
    min_submission_interval: 0,
    min_user_test_interval: 0,
    score_precision: 0,
    analysis_enabled: false,
    analysis_start: '',
    analysis_stop: '',
  });

  useEffect(() => {
    if (contest) {
      setFormData({
        name: contest.name,
        description: contest.description,
        start: formatDateForInput(contest.start),
        stop: formatDateForInput(contest.stop),
        timezone: contest.timezone || 'Asia/Bangkok',
        languages: contest.languages || [],
        submissions_download_allowed: contest.submissions_download_allowed,
        allow_questions: contest.allow_questions,
        allow_user_tests: contest.allow_user_tests,
        allow_unofficial_submission_before_analysis_mode: contest.allow_unofficial_submission_before_analysis_mode,
        block_hidden_participations: contest.block_hidden_participations,
        allow_password_authentication: contest.allow_password_authentication,
        allow_registration: contest.allow_registration,
        ip_restriction: contest.ip_restriction,
        ip_autologin: contest.ip_autologin,
        token_mode: contest.token_mode,
        token_max_number: contest.token_max_number || 0,
        token_min_interval: 0, // Need parse from interval
        token_gen_initial: contest.token_gen_initial,
        token_gen_number: contest.token_gen_number,
        token_gen_interval: 0, // Need parse
        token_gen_max: contest.token_gen_max || 0,
        max_submission_number: contest.max_submission_number || 0,
        max_user_test_number: contest.max_user_test_number || 0,
        min_submission_interval: 0, // Need parse
        min_user_test_interval: 0, // Need parse
        score_precision: contest.score_precision,
        analysis_enabled: contest.analysis_enabled,
        analysis_start: formatDateForInput(contest.analysis_start),
        analysis_stop: formatDateForInput(contest.analysis_stop),
      });
    } else {
        const now = new Date();
      const end = new Date(now.getTime() + 5 * 60 * 60 * 1000); // 5 hours
      const analysisStart = new Date(end.getTime() + 1000);
      const analysisStop = new Date(end.getTime() + 1000 * 60 * 60);

      setFormData({
        name: '',
        description: '',
        start: formatDateForInput(now),
        stop: formatDateForInput(end),
        timezone: 'Asia/Bangkok',
        languages: PROGRAMMING_LANGUAGES.map(l => l.split(' / ')[0].trim()), // Select all by default or none? Let's select all common ones
        submissions_download_allowed: true,
        allow_questions: true,
        allow_user_tests: false,
        allow_unofficial_submission_before_analysis_mode: false,
        block_hidden_participations: false,
        allow_password_authentication: true,
        allow_registration: false,
        ip_restriction: false,
        ip_autologin: false,
        token_mode: 'disabled',
        token_max_number: 0,
        token_min_interval: 0,
        token_gen_initial: 0,
        token_gen_number: 0,
        token_gen_interval: 30,
        token_gen_max: 0,
        max_submission_number: 100,
        max_user_test_number: 0,
        min_submission_interval: 60, // 60s
        min_user_test_interval: 60,
        score_precision: 2,
        analysis_enabled: false,
        analysis_start: formatDateForInput(analysisStart),
        analysis_stop: formatDateForInput(analysisStop),
      });
    }
  }, [contest, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Validate name format
    const nameRegex = /^[A-Za-z0-9_-]+$/;
    if (!nameRegex.test(formData.name)) {
      const msg = 'Contest name must contain only letters, numbers, hyphens and underscores';
      setError(msg);
      addToast({
        type: 'error',
        title: 'Invalid Name',
        message: msg
      });
      setLoading(false);
      return;
    }

    try {
      const payload = { ...formData };

      const result = contest
        ? await apiClient.put(`/api/contests/${contest.id}`, payload)
        : await apiClient.post('/api/contests', payload);

      if (result.success) {
        addToast({
          type: 'success',
          title: contest ? 'Contest Updated' : 'Contest Created',
          message: `Successfully ${contest ? 'updated' : 'created'} contest "${formData.name}"`
        });
        onSuccess();
        onClose();
      } else {
        const msg = result.error || 'Operation failed';
        setError(msg);
        addToast({
          type: 'error',
          title: 'Error',
          message: msg
        });
      }
    } catch {
      const msg = 'An unexpected error occurred';
      setError(msg);
      addToast({
        type: 'error',
        title: 'Error',
        message: msg
      });
    } finally {
      setLoading(false);
    }
  };

  const handleLanguageToggle = (lang: string) => {
    setFormData(prev => {
      const exists = prev.languages.includes(lang);
      return {
        ...prev,
        languages: exists
          ? prev.languages.filter(l => l !== lang)
          : [...prev.languages, lang]
      };
    });
  };

  if (!isOpen || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-black/80 backdrop-blur-md p-4">
      <Card className="w-full max-w-4xl h-[90vh] flex flex-col p-0 relative animate-in fade-in zoom-in-95 duration-200 glass-card border-white/10 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-white/10 flex justify-between items-center bg-white/5">
          <h2 className="text-2xl font-bold text-white tracking-tight flex items-center gap-3">
            <Settings className="w-6 h-6 text-indigo-400" />
            {contest ? 'Edit Contest' : 'Create New Contest'}
          </h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-white transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Tabs & Content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar Tabs */}
          <div className="w-64 bg-black/20 border-r border-white/10 p-4 space-y-2 overflow-y-auto">
            {[
              { id: 'general', label: 'General', icon: FileText },
              { id: 'access', label: 'Access Control', icon: Shield },
              { id: 'tokens', label: 'Tokens', icon: Cpu },
              { id: 'limits', label: 'Limits', icon: Clock },
              { id: 'analysis', label: 'Analysis Mode', icon: Calendar },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as Tab)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${activeTab === tab.id
                  ? 'bg-indigo-500/20 text-indigo-400 ring-1 ring-indigo-500/50'
                  : 'text-neutral-400 hover:bg-white/5 hover:text-white'
                  }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Form Content */}
          <div className="flex-1 overflow-y-auto p-8 relative">
            {error && (
              <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm flex items-center gap-3 sticky top-0 z-10 backdrop-blur-md">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                {error}
              </div>
            )}

            <form id="contest-form" onSubmit={handleSubmit} className="space-y-8 pb-20">
              {/* GENERAL TAB */}
              {activeTab === 'general' && (
                <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Contest Name</label>
                    <input
                      required
                      pattern="^[A-Za-z0-9_-]+$"
                      title="Only letters, numbers, hyphens and underscores are allowed"
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-4 py-3 bg-black/40 border border-white/5 rounded-xl text-white focus:ring-1 focus:ring-indigo-500/50 transition-all font-sans"
                      placeholder="IOI 2025 Selection"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Description</label>
                    <textarea
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      className="w-full px-4 py-3 bg-black/40 border border-white/5 rounded-xl text-white h-32 resize-none focus:ring-1 focus:ring-indigo-500/50"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Start Time</label>
                      <input required type="datetime-local" value={formData.start} onChange={(e) => setFormData({ ...formData, start: e.target.value })} className="w-full px-4 py-3 bg-black/40 border border-white/5 rounded-xl text-white [color-scheme:dark]" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Stop Time</label>
                      <input required type="datetime-local" value={formData.stop} onChange={(e) => setFormData({ ...formData, stop: e.target.value })} className="w-full px-4 py-3 bg-black/40 border border-white/5 rounded-xl text-white [color-scheme:dark]" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Timezone</label>
                    <input required type="text" value={formData.timezone} onChange={(e) => setFormData({ ...formData, timezone: e.target.value })} className="w-full px-4 py-3 bg-black/40 border border-white/5 rounded-xl text-white font-mono" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Allowed Languages</label>
                    <div className="grid grid-cols-3 gap-2 p-4 bg-black/20 rounded-xl border border-white/5">
                      {PROGRAMMING_LANGUAGES.map(langStr => {
                        const lang = langStr.split(' / ')[0].trim(); // Simplified value
                        const isSelected = formData.languages.includes(lang);
                        return (
                          <button
                            key={lang}
                            type="button"
                            onClick={() => handleLanguageToggle(lang)}
                            className={`px-3 py-2 rounded-lg text-xs font-mono text-left transition-all ${isSelected ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-white/5 text-neutral-400 hover:bg-white/10'}`}
                          >
                            {lang}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* ACCESS TAB */}
              {activeTab === 'access' && (
                <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                  {[
                    { key: 'allow_registration', label: 'Allow Public Registration' },
                    { key: 'allow_password_authentication', label: 'Allow Password Authentication' },
                    { key: 'ip_restriction', label: 'Use IP Restriction' },
                    { key: 'ip_autologin', label: 'Use IP Auto-Login' },
                    { key: 'block_hidden_participations', label: 'Block Hidden Participations' },
                    { key: 'allow_questions', label: 'Allow Questions' },
                    { key: 'allow_user_tests', label: 'Allow User Tests' },
                    { key: 'submissions_download_allowed', label: 'Allow Submissions Download' },
                  ].map(item => (
                    <div key={item.key} className="flex items-center justify-between p-4 bg-black/20 rounded-xl border border-white/5">
                      <span className="text-sm font-medium text-neutral-300">{item.label}</span>
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, [item.key]: !formData[item.key as keyof typeof formData] })}
                        className={`w-12 h-6 rounded-full transition-colors relative ${formData[item.key as keyof typeof formData] ? 'bg-emerald-500' : 'bg-neutral-700'}`}
                      >
                        <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${formData[item.key as keyof typeof formData] ? 'left-7' : 'left-1'}`} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* TOKENS TAB */}
              {activeTab === 'tokens' && (
                <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Token Mode</label>
                    <select
                      value={formData.token_mode}
                      onChange={(e) => setFormData({ ...formData, token_mode: e.target.value })}
                      className="w-full px-4 py-3 bg-black/40 border border-white/5 rounded-xl text-white focus:ring-1 focus:ring-indigo-500/50"
                    >
                      <option value="disabled">Disabled</option>
                      <option value="finite">Finite</option>
                      <option value="infinite">Infinite</option>
                    </select>
                  </div>
                  {formData.token_mode !== 'disabled' && (
                    <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Max Tokens</label>
                        <input type="number" value={formData.token_max_number} onChange={(e) => setFormData({ ...formData, token_max_number: parseInt(e.target.value) || 0 })} className="w-full px-4 py-3 bg-black/40 border border-white/5 rounded-xl text-white" />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Initial Tokens</label>
                        <input type="number" value={formData.token_gen_initial} onChange={(e) => setFormData({ ...formData, token_gen_initial: parseInt(e.target.value) || 0 })} className="w-full px-4 py-3 bg-black/40 border border-white/5 rounded-xl text-white" />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Gen Amount</label>
                        <input type="number" value={formData.token_gen_number} onChange={(e) => setFormData({ ...formData, token_gen_number: parseInt(e.target.value) || 0 })} className="w-full px-4 py-3 bg-black/40 border border-white/5 rounded-xl text-white" />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Gen Interval (min)</label>
                        <input type="number" value={formData.token_gen_interval} onChange={(e) => setFormData({ ...formData, token_gen_interval: parseInt(e.target.value) || 0 })} className="w-full px-4 py-3 bg-black/40 border border-white/5 rounded-xl text-white" />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* LIMITS TAB */}
              {activeTab === 'limits' && (
                <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Max Submissions</label>
                      <input type="number" value={formData.max_submission_number} onChange={(e) => setFormData({ ...formData, max_submission_number: parseInt(e.target.value) || 0 })} className="w-full px-4 py-3 bg-black/40 border border-white/5 rounded-xl text-white" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Min Interval (sec)</label>
                      <input type="number" value={formData.min_submission_interval} onChange={(e) => setFormData({ ...formData, min_submission_interval: parseInt(e.target.value) || 0 })} className="w-full px-4 py-3 bg-black/40 border border-white/5 rounded-xl text-white" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Max User Tests</label>
                      <input type="number" value={formData.max_user_test_number} onChange={(e) => setFormData({ ...formData, max_user_test_number: parseInt(e.target.value) || 0 })} className="w-full px-4 py-3 bg-black/40 border border-white/5 rounded-xl text-white" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Min User Test Interval (sec)</label>
                      <input type="number" value={formData.min_user_test_interval} onChange={(e) => setFormData({ ...formData, min_user_test_interval: parseInt(e.target.value) || 0 })} className="w-full px-4 py-3 bg-black/40 border border-white/5 rounded-xl text-white" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Score Precision (decimals)</label>
                      <input type="number" value={formData.score_precision} onChange={(e) => setFormData({ ...formData, score_precision: parseInt(e.target.value) || 0 })} className="w-full px-4 py-3 bg-black/40 border border-white/5 rounded-xl text-white" />
                    </div>
                  </div>
                </div>
              )}

              {/* ANALYSIS TAB */}
              {activeTab === 'analysis' && (
                <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                  <div className="flex items-center justify-between p-4 bg-black/20 rounded-xl border border-white/5">
                    <span className="text-sm font-medium text-neutral-300">Enable Analysis Mode</span>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, analysis_enabled: !formData.analysis_enabled })}
                      className={`w-12 h-6 rounded-full transition-colors relative ${formData.analysis_enabled ? 'bg-emerald-500' : 'bg-neutral-700'}`}
                    >
                      <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${formData.analysis_enabled ? 'left-7' : 'left-1'}`} />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Analysis Start</label>
                      <input required type="datetime-local" value={formData.analysis_start} onChange={(e) => setFormData({ ...formData, analysis_start: e.target.value })} className="w-full px-4 py-3 bg-black/40 border border-white/5 rounded-xl text-white [color-scheme:dark]" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Analysis Stop</label>
                      <input required type="datetime-local" value={formData.analysis_stop} onChange={(e) => setFormData({ ...formData, analysis_stop: e.target.value })} className="w-full px-4 py-3 bg-black/40 border border-white/5 rounded-xl text-white [color-scheme:dark]" />
                    </div>
                  </div>
                </div>
              )}

            </form>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-white/10 bg-black/20 flex justify-end gap-3 z-20">
          <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={loading}
              className="px-6 text-neutral-400 hover:text-white"
            >
              Cancel
            </Button>
            <Button 
            type="submit"
            form="contest-form"
              variant="primary" 
            className="bg-indigo-600 hover:bg-indigo-500 text-white min-w-[140px] shadow-lg shadow-indigo-500/20 rounded-xl"
              disabled={loading}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : (contest ? 'Save Changes' : 'Create Contest')}
            </Button>
        </div>
      </Card>
    </div>,
    document.body
  );
}

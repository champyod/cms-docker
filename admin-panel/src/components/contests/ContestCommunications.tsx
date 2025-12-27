'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/core/Card';
import { 
  Megaphone, MessageSquare, Trophy, Plus, Send, X, 
  ChevronDown, ChevronUp, Eye, EyeOff, Reply, Trash2
} from 'lucide-react';
import { getAnnouncements, createAnnouncement, deleteAnnouncement } from '@/app/actions/announcements';
import { getQuestions, replyToQuestion, ignoreQuestion, unignoreQuestion } from '@/app/actions/questions';
import { getRanking } from '@/app/actions/ranking';

interface ContestCommunicationsProps {
  contestId: number;
  adminId: number;
}

export function ContestCommunications({ contestId, adminId }: ContestCommunicationsProps) {
  const [activeTab, setActiveTab] = useState<'announcements' | 'questions' | 'ranking'>('announcements');
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [questions, setQuestions] = useState<any[]>([]);
  const [ranking, setRanking] = useState<{ ranking: any[], tasks: any[] } | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Announcement form
  const [showAnnouncementForm, setShowAnnouncementForm] = useState(false);
  const [announcementSubject, setAnnouncementSubject] = useState('');
  const [announcementText, setAnnouncementText] = useState('');
  
  // Question reply
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const [replySubject, setReplySubject] = useState('');
  const [replyText, setReplyText] = useState('');

  useEffect(() => {
    loadData();
  }, [contestId, activeTab]);

  const loadData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'announcements') {
        const data = await getAnnouncements(contestId);
        setAnnouncements(data);
      } else if (activeTab === 'questions') {
        const data = await getQuestions(contestId);
        setQuestions(data);
      } else if (activeTab === 'ranking') {
        const data = await getRanking(contestId);
        setRanking(data);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAnnouncement = async () => {
    if (!announcementSubject.trim() || !announcementText.trim()) return;
    await createAnnouncement(contestId, adminId, {
      subject: announcementSubject,
      text: announcementText,
    });
    setShowAnnouncementForm(false);
    setAnnouncementSubject('');
    setAnnouncementText('');
    loadData();
  };

  const handleDeleteAnnouncement = async (id: number) => {
    if (confirm('Delete this announcement?')) {
      await deleteAnnouncement(id);
      loadData();
    }
  };

  const handleReply = async (questionId: number) => {
    if (!replySubject.trim() || !replyText.trim()) return;
    await replyToQuestion(questionId, adminId, {
      reply_subject: replySubject,
      reply_text: replyText,
    });
    setReplyingTo(null);
    setReplySubject('');
    setReplyText('');
    loadData();
  };

  const handleIgnore = async (questionId: number, ignored: boolean) => {
    if (ignored) {
      await unignoreQuestion(questionId);
    } else {
      await ignoreQuestion(questionId);
    }
    loadData();
  };

  const formatTime = (date: Date) => new Date(date).toLocaleString();

  return (
    <Card className="glass-card border-white/5 overflow-hidden">
      {/* Tabs */}
      <div className="flex border-b border-white/5">
        <button
          onClick={() => setActiveTab('announcements')}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
            activeTab === 'announcements' ? 'text-indigo-400 border-b-2 border-indigo-400' : 'text-neutral-400 hover:text-white'
          }`}
        >
          <Megaphone className="w-4 h-4" />
          Announcements
        </button>
        <button
          onClick={() => setActiveTab('questions')}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
            activeTab === 'questions' ? 'text-indigo-400 border-b-2 border-indigo-400' : 'text-neutral-400 hover:text-white'
          }`}
        >
          <MessageSquare className="w-4 h-4" />
          Questions
        </button>
        <button
          onClick={() => setActiveTab('ranking')}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
            activeTab === 'ranking' ? 'text-indigo-400 border-b-2 border-indigo-400' : 'text-neutral-400 hover:text-white'
          }`}
        >
          <Trophy className="w-4 h-4" />
          Ranking
        </button>
      </div>

      <div className="p-4">
        {loading ? (
          <div className="text-neutral-400 text-sm">Loading...</div>
        ) : (
          <>
            {/* Announcements Tab */}
            {activeTab === 'announcements' && (
              <div className="space-y-4">
                <button
                  onClick={() => setShowAnnouncementForm(true)}
                  className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600/20 text-indigo-400 rounded-lg text-sm hover:bg-indigo-600/30"
                >
                  <Plus className="w-4 h-4" />
                  New Announcement
                </button>

                {showAnnouncementForm && (
                  <div className="p-4 bg-black/30 rounded-lg space-y-3">
                    <input
                      type="text"
                      value={announcementSubject}
                      onChange={(e) => setAnnouncementSubject(e.target.value)}
                      placeholder="Subject"
                      className="w-full px-3 py-2 bg-black/50 border border-white/10 rounded-lg text-white text-sm"
                    />
                    <textarea
                      value={announcementText}
                      onChange={(e) => setAnnouncementText(e.target.value)}
                      placeholder="Message content..."
                      rows={3}
                      className="w-full px-3 py-2 bg-black/50 border border-white/10 rounded-lg text-white text-sm"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleCreateAnnouncement}
                        className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-500"
                      >
                        <Send className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setShowAnnouncementForm(false)}
                        className="px-3 py-1.5 bg-neutral-700 text-white rounded-lg text-sm hover:bg-neutral-600"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {announcements.length === 0 ? (
                  <p className="text-neutral-500 text-sm">No announcements yet.</p>
                ) : (
                  <div className="space-y-2">
                    {announcements.map((ann) => (
                      <div key={ann.id} className="p-3 bg-black/30 rounded-lg">
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="font-medium text-white">{ann.subject}</div>
                            <div className="text-sm text-neutral-300 mt-1">{ann.text}</div>
                            <div className="text-xs text-neutral-500 mt-2">
                              {formatTime(ann.timestamp)} by {ann.admins?.username || 'System'}
                            </div>
                          </div>
                          <button
                            onClick={() => handleDeleteAnnouncement(ann.id)}
                            className="p-1 text-red-400 hover:bg-red-500/20 rounded"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Questions Tab */}
            {activeTab === 'questions' && (
              <div className="space-y-4">
                {questions.length === 0 ? (
                  <p className="text-neutral-500 text-sm">No questions from contestants.</p>
                ) : (
                  <div className="space-y-3">
                    {questions.map((q) => (
                      <div key={q.id} className={`p-3 rounded-lg ${q.ignored ? 'bg-neutral-800/50' : 'bg-black/30'}`}>
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-white">{q.subject}</span>
                              {q.ignored && <span className="text-xs text-neutral-500">(Ignored)</span>}
                              {q.reply_timestamp && <span className="text-xs text-emerald-400">(Replied)</span>}
                            </div>
                            <div className="text-sm text-neutral-300 mt-1">{q.text}</div>
                            <div className="text-xs text-neutral-500 mt-2">
                              From: {q.participations?.users?.username} at {formatTime(q.question_timestamp)}
                            </div>
                            
                            {q.reply_timestamp && (
                              <div className="mt-3 p-2 bg-indigo-500/10 rounded-lg border-l-2 border-indigo-500">
                                <div className="text-sm font-medium text-indigo-300">{q.reply_subject}</div>
                                <div className="text-sm text-neutral-300">{q.reply_text}</div>
                              </div>
                            )}
                          </div>
                          
                          <div className="flex items-center gap-1">
                            {!q.reply_timestamp && (
                              <button
                                onClick={() => setReplyingTo(replyingTo === q.id ? null : q.id)}
                                className="p-1.5 text-indigo-400 hover:bg-indigo-500/20 rounded"
                              >
                                <Reply className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              onClick={() => handleIgnore(q.id, q.ignored)}
                              className="p-1.5 text-neutral-400 hover:bg-white/10 rounded"
                            >
                              {q.ignored ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>
                        
                        {replyingTo === q.id && (
                          <div className="mt-3 p-3 bg-black/30 rounded-lg space-y-2">
                            <input
                              type="text"
                              value={replySubject}
                              onChange={(e) => setReplySubject(e.target.value)}
                              placeholder="Reply subject"
                              className="w-full px-3 py-2 bg-black/50 border border-white/10 rounded-lg text-white text-sm"
                            />
                            <textarea
                              value={replyText}
                              onChange={(e) => setReplyText(e.target.value)}
                              placeholder="Reply message..."
                              rows={2}
                              className="w-full px-3 py-2 bg-black/50 border border-white/10 rounded-lg text-white text-sm"
                            />
                            <button
                              onClick={() => handleReply(q.id)}
                              className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-500"
                            >
                              Send Reply
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Ranking Tab */}
            {activeTab === 'ranking' && ranking && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-neutral-400 border-b border-white/5">
                      <th className="p-2">#</th>
                      <th className="p-2">User</th>
                      {ranking.tasks.map((t) => (
                        <th key={t.id} className="p-2 text-center" title={t.title}>{t.name}</th>
                      ))}
                      <th className="p-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranking.ranking.map((entry: any) => (
                      <tr key={entry.participationId} className="border-b border-white/5 hover:bg-white/5">
                        <td className="p-2 text-neutral-400">{entry.rank}</td>
                        <td className="p-2 text-white font-medium">{entry.user.username}</td>
                        {ranking.tasks.map((t) => (
                          <td key={t.id} className="p-2 text-center text-neutral-300">
                            {entry.taskScores[t.id] !== undefined ? entry.taskScores[t.id].toFixed(t.score_precision) : '-'}
                          </td>
                        ))}
                        <td className="p-2 text-right font-bold text-indigo-400">{entry.totalScore.toFixed(0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {ranking.ranking.length === 0 && (
                  <p className="text-neutral-500 text-sm text-center py-4">No submissions yet.</p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

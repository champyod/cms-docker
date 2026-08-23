'use client';

import { useState, useCallback } from 'react';
import { getAnnouncements, createAnnouncement, deleteAnnouncement } from '@/app/actions/announcements';
import { getQuestions, replyToQuestion, ignoreQuestion, unignoreQuestion } from '@/app/actions/questions';
import { getRanking } from '@/app/actions/ranking';

export type CommTab = 'announcements' | 'questions' | 'ranking';

export function useContestCommunications(contestId: number, adminId: number) {
  const [activeTab, setActiveTab] = useState<CommTab>('announcements');
  const [announcements, setAnnouncements] = useState<unknown[]>([]);
  const [questions, setQuestions] = useState<unknown[]>([]);
  const [ranking, setRanking] = useState<{ ranking: unknown[]; tasks: unknown[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAnnouncementForm, setShowAnnouncementForm] = useState(false);
  const [announcementSubject, setAnnouncementSubject] = useState('');
  const [announcementText, setAnnouncementText] = useState('');
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const [replySubject, setReplySubject] = useState('');
  const [replyText, setReplyText] = useState('');

  const loadData = useCallback(async (tab: CommTab) => {
    setLoading(true);
    try {
      if (tab === 'announcements') setAnnouncements(await getAnnouncements(contestId));
      else if (tab === 'questions') setQuestions(await getQuestions(contestId));
      else if (tab === 'ranking') setRanking(await getRanking(contestId) as { ranking: unknown[]; tasks: unknown[] });
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  }, [contestId]);

  const handleCreateAnnouncement = async () => {
    if (!announcementSubject.trim() || !announcementText.trim()) return;
    await createAnnouncement(contestId, adminId, { subject: announcementSubject, text: announcementText });
    setShowAnnouncementForm(false);
    setAnnouncementSubject('');
    setAnnouncementText('');
    void loadData('announcements');
  };

  const handleDeleteAnnouncement = async (id: number) => {
    if (confirm('Delete this announcement?')) {
      await deleteAnnouncement(id);
      void loadData('announcements');
    }
  };

  const handleReply = async (questionId: number) => {
    if (!replySubject.trim() || !replyText.trim()) return;
    await replyToQuestion(questionId, adminId, { reply_subject: replySubject, reply_text: replyText });
    setReplyingTo(null);
    setReplySubject('');
    setReplyText('');
    void loadData('questions');
  };

  const handleIgnore = async (questionId: number, ignored: boolean) => {
    if (ignored) await unignoreQuestion(questionId);
    else await ignoreQuestion(questionId);
    void loadData('questions');
  };

  return {
    activeTab, setActiveTab, announcements, questions, ranking, loading,
    showAnnouncementForm, setShowAnnouncementForm,
    announcementSubject, setAnnouncementSubject, announcementText, setAnnouncementText,
    replyingTo, setReplyingTo, replySubject, setReplySubject, replyText, setReplyText,
    loadData, handleCreateAnnouncement, handleDeleteAnnouncement, handleReply, handleIgnore,
  };
}

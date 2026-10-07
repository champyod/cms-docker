'use client';

import { useState, useCallback } from 'react';
import { getAnnouncements, createAnnouncement, deleteAnnouncement } from '@/app/actions/announcements';
import { getQuestions, replyToQuestion, ignoreQuestion, unignoreQuestion } from '@/app/actions/questions';
import { getRanking } from '@/app/actions/ranking';
import { useConfirm } from '@/hooks/useConfirm';
import { useConfirmationCopy } from '@/hooks/useConfirmationCopy';
import { useActionFeedback } from '@/hooks/useActionFeedback';

export type CommTab = 'announcements' | 'questions' | 'ranking';

export function useContestCommunications(contestId: number, adminId: number) {
  const confirm = useConfirm();
  const { destructiveConfirm } = useConfirmationCopy();
  // Why: mutation actions throw on 403 — the feedback path toasts the denial
  // instead of leaving an unhandled rejection with no visible outcome.
  const runAction = useActionFeedback();
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

  const handleCreateAnnouncement = async (): Promise<void> => {
    if (!announcementSubject.trim() || !announcementText.trim()) return;
    const result = await runAction(
      { pending: 'Publishing announcement...', success: 'Announcement published', failure: 'Publish failed' },
      () => createAnnouncement(contestId, adminId, { subject: announcementSubject, text: announcementText }),
    );
    if (!result?.success) return;
    setShowAnnouncementForm(false);
    setAnnouncementSubject('');
    setAnnouncementText('');
    void loadData('announcements');
  };

  const handleDeleteAnnouncement = async (id: number): Promise<void> => {
    if (!(await confirm(destructiveConfirm('announcement')))) return;
    const result = await runAction(
      { pending: 'Deleting announcement...', success: 'Announcement deleted', failure: 'Delete failed' },
      () => deleteAnnouncement(id),
    );
    if (result?.success) void loadData('announcements');
  };

  const handleReply = async (questionId: number): Promise<void> => {
    if (!replySubject.trim() || !replyText.trim()) return;
    const result = await runAction(
      { pending: 'Sending reply...', success: 'Reply sent', failure: 'Reply failed' },
      () => replyToQuestion(questionId, adminId, { reply_subject: replySubject, reply_text: replyText }),
    );
    if (!result?.success) return;
    setReplyingTo(null);
    setReplySubject('');
    setReplyText('');
    void loadData('questions');
  };

  const handleIgnore = async (questionId: number, ignored: boolean): Promise<void> => {
    const result = await runAction(
      { pending: ignored ? 'Unignoring question...' : 'Ignoring question...', success: 'Question updated', failure: 'Update failed' },
      () => (ignored ? unignoreQuestion(questionId) : ignoreQuestion(questionId)),
    );
    if (result?.success) void loadData('questions');
  };

  return {
    activeTab, setActiveTab, announcements, questions, ranking, loading,
    showAnnouncementForm, setShowAnnouncementForm,
    announcementSubject, setAnnouncementSubject, announcementText, setAnnouncementText,
    replyingTo, setReplyingTo, replySubject, setReplySubject, replyText, setReplyText,
    loadData, handleCreateAnnouncement, handleDeleteAnnouncement, handleReply, handleIgnore,
  };
}

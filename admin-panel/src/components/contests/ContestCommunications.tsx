'use client';

import { useEffect } from 'react';
import { Card } from '@/components/core/Card';
import { Megaphone, MessageSquare, Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useContestCommunications } from './contest-communications/useContestCommunications';
import { AnnouncementsPanel, type AnnouncementRow } from './contest-communications/AnnouncementsPanel';
import { QuestionsPanel, type QuestionRow } from './contest-communications/QuestionsPanel';
import { RankingTable, type RankingEntry, type TaskCol } from './contest-communications/RankingTable';

interface ContestCommunicationsProps {
  contestId: number;
  adminId: number;
}

const TAB_BASE = 'flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors';
const TAB_ACTIVE = 'border-b-2 border-primary text-primary';
const TAB_INACTIVE = 'border-b-2 border-transparent text-muted-foreground hover:text-foreground';

export function ContestCommunications({ contestId, adminId }: ContestCommunicationsProps) {
  const { activeTab, setActiveTab, loadData, loading, announcements, questions, ranking, showAnnouncementForm, announcementSubject, announcementText, replyingTo, replySubject, replyText, setShowAnnouncementForm, setAnnouncementSubject, setAnnouncementText, setReplyingTo, setReplySubject, setReplyText, handleCreateAnnouncement, handleDeleteAnnouncement, handleReply, handleIgnore } = useContestCommunications(contestId, adminId);

  useEffect(() => {
    void loadData(activeTab);
  }, [contestId, activeTab, loadData]);

  return (
    <Card className="overflow-hidden">
      <div className="flex border-b border-border">
        <button onClick={() => setActiveTab('announcements')} className={cn(TAB_BASE, activeTab === 'announcements' ? TAB_ACTIVE : TAB_INACTIVE)}>
          <Megaphone className="h-4 w-4" />Announcements
        </button>
        <button onClick={() => setActiveTab('questions')} className={cn(TAB_BASE, activeTab === 'questions' ? TAB_ACTIVE : TAB_INACTIVE)}>
          <MessageSquare className="h-4 w-4" />Questions
        </button>
        <button onClick={() => setActiveTab('ranking')} className={cn(TAB_BASE, activeTab === 'ranking' ? TAB_ACTIVE : TAB_INACTIVE)}>
          <Trophy className="h-4 w-4" />Ranking
        </button>
      </div>
      <div className="p-4">
        {loading ? <div className="text-sm text-muted-foreground">Loading...</div> : (
          <>
            {activeTab === 'announcements' && <AnnouncementsPanel announcements={announcements as AnnouncementRow[]} showForm={showAnnouncementForm} subject={announcementSubject} text={announcementText} onShowForm={setShowAnnouncementForm} onSubject={setAnnouncementSubject} onText={setAnnouncementText} onCreate={handleCreateAnnouncement} onDelete={handleDeleteAnnouncement} />}
            {activeTab === 'questions' && <QuestionsPanel questions={questions as QuestionRow[]} replyingTo={replyingTo} replySubject={replySubject} replyText={replyText} onReplyingTo={setReplyingTo} onReplySubject={setReplySubject} onReplyText={setReplyText} onReply={handleReply} onIgnore={handleIgnore} />}
            {activeTab === 'ranking' && <RankingTable ranking={ranking as { ranking: RankingEntry[]; tasks: TaskCol[] } | null} />}
          </>
        )}
      </div>
    </Card>
  );
}

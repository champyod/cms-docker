'use client';

import { useEffect } from 'react';
import { Card } from '@/components/core/Card';
import { Megaphone, MessageSquare, Trophy } from 'lucide-react';
import { useContestCommunications } from './contest-communications/useContestCommunications';
import { AnnouncementsPanel } from './contest-communications/AnnouncementsPanel';
import { QuestionsPanel } from './contest-communications/QuestionsPanel';
import { RankingTable } from './contest-communications/RankingTable';

interface ContestCommunicationsProps {
  contestId: number;
  adminId: number;
}

export function ContestCommunications({ contestId, adminId }: ContestCommunicationsProps) {
  const comm = useContestCommunications(contestId, adminId);

  useEffect(() => {
    void comm.loadData(comm.activeTab);
  }, [contestId, comm.activeTab, comm.loadData]);

  return (
    <Card className="glass-card border-white/5 overflow-hidden">
      <div className="flex border-b border-white/5">
        <button onClick={() => comm.setActiveTab('announcements')} className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${comm.activeTab === 'announcements' ? 'text-indigo-400 border-b-2 border-indigo-400' : 'text-neutral-400 hover:text-white'}`}>
          <Megaphone className="w-4 h-4" />Announcements
        </button>
        <button onClick={() => comm.setActiveTab('questions')} className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${comm.activeTab === 'questions' ? 'text-indigo-400 border-b-2 border-indigo-400' : 'text-neutral-400 hover:text-white'}`}>
          <MessageSquare className="w-4 h-4" />Questions
        </button>
        <button onClick={() => comm.setActiveTab('ranking')} className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${comm.activeTab === 'ranking' ? 'text-indigo-400 border-b-2 border-indigo-400' : 'text-neutral-400 hover:text-white'}`}>
          <Trophy className="w-4 h-4" />Ranking
        </button>
      </div>
      <div className="p-4">
        {comm.loading ? <div className="text-neutral-400 text-sm">Loading...</div> : (
          <>
            {comm.activeTab === 'announcements' && <AnnouncementsPanel announcements={comm.announcements as never[]} showForm={comm.showAnnouncementForm} subject={comm.announcementSubject} text={comm.announcementText} onShowForm={comm.setShowAnnouncementForm} onSubject={comm.setAnnouncementSubject} onText={comm.setAnnouncementText} onCreate={comm.handleCreateAnnouncement} onDelete={comm.handleDeleteAnnouncement} />}
            {comm.activeTab === 'questions' && <QuestionsPanel questions={comm.questions as never[]} replyingTo={comm.replyingTo} replySubject={comm.replySubject} replyText={comm.replyText} onReplyingTo={comm.setReplyingTo} onReplySubject={comm.setReplySubject} onReplyText={comm.setReplyText} onReply={comm.handleReply} onIgnore={comm.handleIgnore} />}
            {comm.activeTab === 'ranking' && <RankingTable ranking={comm.ranking as never} />}
          </>
        )}
      </div>
    </Card>
  );
}

import { getInterviewers } from '@/actions/explore'
import React from 'react'
import ExploreGrid from './_components/ExploreGrid';
import PageHeader from '@/components/reusables';

async function page() {

    const interviewers=await getInterviewers();

  return (
    <main className="min-h-screen bg-black">
      {/* Page header */}
      <PageHeader
        label="Explore"
        gray="Find your"
        gold="expert interviewer"
        description="Browse senior engineers from top companies."
      />

      {/* Content */}
      <div className="max-w-6xl mx-auto px-8 xl:px-0 py-10">
        <ExploreGrid interviewers={interviewers} />
      </div>
    </main>
  );
}

export default page
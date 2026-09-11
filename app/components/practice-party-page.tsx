'use client';
import PracticePartyPanel from './practice-party-panel';
export default function PracticePartyPage({ id }: { id: number }) { return <PracticePartyPanel id={id} onClose={() => { window.location.href = '/practice-parties'; }} />; }

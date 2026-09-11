import PracticePartyPage from '../../components/practice-party-page';
export default async function PartyPage({ params }: { params: Promise<{ id: string }> }) { return <PracticePartyPage id={Number((await params).id)} />; }

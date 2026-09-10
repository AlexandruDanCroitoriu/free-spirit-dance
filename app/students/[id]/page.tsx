import { redirect } from "next/navigation";

export default async function StudentRedirect({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  redirect(Number.isSafeInteger(id) && id > 0 ? `/students?student=${id}` : "/students");
}

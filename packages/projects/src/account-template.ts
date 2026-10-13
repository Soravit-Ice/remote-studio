export const accountTemplate = `'use client';
import {useEffect, useState} from 'react';
import {createAuthClient} from 'better-auth/react';
import {Button} from '@/components/ui/button';
const client = createAuthClient();
type Note = {id: string; body: string};

export default function Account() {
  const {data: session, isPending} = client.useSession();
  const [message, setMessage] = useState('');
  const [notes, setNotes] = useState<Note[]>([]);
  const [editing, setEditing] = useState<Note | null>(null);
  const [busy, setBusy] = useState(false);
  const userId = session?.user.id;

  useEffect(() => {
    setNotes([]);
    setEditing(null);
    if (!userId) return;
    const controller = new AbortController();
    fetch('/api/notes', {signal: controller.signal})
      .then(async response => {
        if (!response.ok) throw new Error('Could not load notes.');
        const result = await response.json();
        if (!controller.signal.aborted) setNotes(result);
      })
      .catch(error => {if (!controller.signal.aborted) setMessage(error.message);});
    return () => controller.abort();
  }, [userId]);

  async function perform(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try { await action(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Please try again.'); }
    finally { setBusy(false); }
  }
  async function refresh() {
    const response = await fetch('/api/notes');
    if (!response.ok) throw new Error('Could not load notes. Please sign in again.');
    setNotes(await response.json());
  }
  async function save(body: FormDataEntryValue | null, id?: string) {
    const response = await fetch('/api/notes' + (id ? '/' + encodeURIComponent(id) : ''), {
      method: id ? 'PATCH' : 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({body})
    });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? 'Could not save the note.');
    await refresh();
    setMessage('Saved.');
  }

  return <section className='hero' aria-busy={busy}>
    <h1>{session ? 'Your workspace' : 'Welcome back.'}</h1>
    {isPending ? <p role='status'>Checking your session…</p> : !session ?
      <form onSubmit={event => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        void perform(async () => {
          const input = {email: String(data.get('email')), password: String(data.get('password')), name: String(data.get('name'))};
          const result = data.get('mode') === 'signup' ? await client.signUp.email(input) : await client.signIn.email(input);
          if (result.error) throw new Error(result.error.message ?? 'Sign-in failed.');
          setMessage('Signed in.');
        });
      }}>
        <label>Name<input name='name' autoComplete='name' disabled={busy}/></label>
        <label>Email<input name='email' type='email' required autoComplete='email' disabled={busy}/></label>
        <label>Password<input name='password' type='password' required minLength={8} autoComplete='current-password' disabled={busy}/></label>
        <label>Action<select name='mode' disabled={busy}><option value='signin'>Sign in</option><option value='signup'>Create account</option></select></label>
        <Button type='submit' disabled={busy}>{busy ? 'Please wait…' : 'Continue'}</Button>
      </form> : <>
        <p>Signed in as {session.user.email}</p>
        <Button disabled={busy} onClick={() => void perform(async () => {
          const result = await client.signOut();
          if (result.error) throw new Error(result.error.message ?? 'Could not sign out.');
          setNotes([]); setEditing(null); setMessage('Signed out.');
        })}>Sign out</Button>
        <form onSubmit={event => {
          event.preventDefault();
          const form = event.currentTarget, body = new FormData(form).get('body');
          void perform(async () => {await save(body); form.reset();});
        }}>
          <label>Your note<textarea name='body' required maxLength={10000} disabled={busy}/></label>
          <Button type='submit' disabled={busy}>Save note</Button>
        </form>
        <Button disabled={busy} onClick={() => void perform(refresh)}>Refresh notes</Button>
        {notes.length === 0 && <p>No notes yet. Write your first note above.</p>}
        <ul>{notes.map(note => <li className='card' key={note.id}>
          {editing?.id === note.id ? <form onSubmit={event => {
            event.preventDefault();
            const body = new FormData(event.currentTarget).get('body');
            void perform(async () => {await save(body, note.id); setEditing(null);});
          }}>
            <label>Edit note<textarea name='body' defaultValue={note.body} required maxLength={10000} disabled={busy}/></label>
            <div className='actions'><Button type='submit' disabled={busy}>Save changes</Button>
              <Button type='button' disabled={busy} onClick={() => setEditing(null)}>Cancel</Button></div>
          </form> : <>
            <p>{note.body}</p>
            <div className='actions'><Button disabled={busy} onClick={() => setEditing(note)}>Edit note</Button>
              <Button disabled={busy} onClick={() => void perform(async () => {
                const response = await fetch('/api/notes/' + encodeURIComponent(note.id), {method: 'DELETE'});
                if (!response.ok) throw new Error('Could not delete the note.');
                await refresh(); setMessage('Deleted.');
              })}>Delete note</Button></div>
          </>}
        </li>)}</ul>
      </>}
    <p role='status'>{message}</p>
  </section>;
}
`;

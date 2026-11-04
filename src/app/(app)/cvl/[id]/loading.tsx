// The app's loading screen, shown at once when this page is opened (and, for
// a record, when moving between its pages) while the server reads it. Next
// shows a loading.tsx only for what changes beneath its own folder, so the
// one at the top of the app (../loading.tsx) never covers clicks within a
// section: each record carries this one. Lists have none, so filtering and
// paging keep the list on screen.
export { default } from '@/app/(app)/loading'

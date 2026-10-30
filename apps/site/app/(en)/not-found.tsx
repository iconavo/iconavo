import { NotFound } from "../../components/pages/NotFound";

// Неизвестные адреса отдаёт app/global-not-found.tsx; эта страница — на случай notFound() в страницах
// документации.
export default function Page() {
  return <NotFound />;
}

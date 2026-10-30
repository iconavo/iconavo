import { NotFound } from "../../components/pages/NotFound";

// Неизвестные адреса отдаёт app/global-not-found.tsx; эта страница — на случай 404 у русских страниц
// наборов (/ru/xyz): та же страница на двух языках, но в русской раскладке.
export default function Page() {
  return <NotFound />;
}

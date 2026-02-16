import Sidebar from "@/components/Sidebar";
import Header from "@/components/Header";
import { AuthProvider } from "@/contexts/AuthContext";

export default function AdminDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <div className="min-h-screen bg-gray-50">
        <Sidebar />
        <div className="ml-64">
          <Header />
          <main className="mt-16 p-6">{children}</main>
        </div>
      </div>
    </AuthProvider>
  );
}

import Sidebar from "@/components/Sidebar";
import Header from "@/components/Header";
import { DataProvider } from "@/contexts/DataContext";
import { AuthProvider } from "@/contexts/AuthContext";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <DataProvider>
        <div className="min-h-screen bg-gray-50">
          <Sidebar />
          <div className="ml-64">
            <Header />
            <main className="mt-16 p-6">{children}</main>
          </div>
        </div>
      </DataProvider>
    </AuthProvider>
  );
}

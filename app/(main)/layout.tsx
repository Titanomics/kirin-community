import Sidebar from "@/components/Sidebar";
import Header from "@/components/Header";
import { AuthProvider } from "@/contexts/AuthContext";
import { MobileMenuProvider } from "@/contexts/MobileMenuContext";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <MobileMenuProvider>
        <div className="min-h-screen bg-gray-50">
          <Sidebar />
          <div className="md:ml-64">
            <Header />
            <main className="mt-16 p-4 md:p-6">{children}</main>
          </div>
        </div>
      </MobileMenuProvider>
    </AuthProvider>
  );
}

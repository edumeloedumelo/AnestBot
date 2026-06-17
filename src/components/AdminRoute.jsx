import { base44 } from "@/api/base44Client";
import { Navigate } from "react-router-dom";
import { useState, useEffect } from "react";

export default function AdminRoute({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    base44.auth.me().then(u => { setUser(u); setLoading(false); }).catch(() => { setLoading(false); });
  }, []);

  if (loading) {
    return <div className="fixed inset-0 flex items-center justify-center bg-background"><div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" /></div>;
  }

  if (!user || user.role !== "admin") {
    return <Navigate to="/" replace />;
  }

  return children;
}
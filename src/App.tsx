import React, { useState, useRef, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, Type, Download, LogOut, Plus, Trash2, Settings, Image as ImageIcon, Type as FontIcon, Save, AlignLeft, AlignCenter, AlignRight, Calendar, UserCircle, Shield, Key, Users, ChevronDown, UserPlus, UserMinus, Edit2 } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { motion, AnimatePresence } from "motion/react";

interface User {
  username: string;
  role: 'admin' | 'user';
  selectedFonts?: string[];
}

interface Font {
  name: string;
  url: string;
}

interface TextLayer {
  id: string;
  name: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  fontFamily: string;
  strokeColor: string;
  strokeWidth: number;
  shadowBlur: number;
  shadowColor: string;
  textAlign: 'left' | 'center' | 'right';
  type?: 'text' | 'date';
}

interface ImageProject {
  id: string;
  username: string;
  imageUrl: string;
  layers: TextLayer[];
  name: string;
  createdAt: string;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [projects, setProjects] = useState<ImageProject[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [layers, setLayers] = useState<TextLayer[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [fonts, setFonts] = useState<Font[]>([]);
  const [isFontLoading, setIsFontLoading] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [isSaving, setIsSaving] = useState(false);
  const [newAccountUsername, setNewAccountUsername] = useState("");
  const [newAccountPassword, setNewAccountPassword] = useState("");
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [projectToDeleteId, setProjectToDeleteId] = useState<string | null>(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [showUserManagementModal, setShowUserManagementModal] = useState(false);
  const [showFontManagementModal, setShowFontManagementModal] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editingFont, setEditingFont] = useState<Font | null>(null);
  const [newFontName, setNewFontName] = useState("");
  const [userManagementPassword, setUserManagementPassword] = useState("");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDraggingRef = useRef(false);
  const dragStartPos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await fetch("/api/health");
        const data = await res.json();
        console.log("Server health:", data);
      } catch (err) {
        console.error("Server health check failed:", err);
      }
    };
    checkHealth();
  }, []);

  useEffect(() => {
    if (user) {
      fetchFonts();
      fetchProjects();
    }
  }, [user]);

  const fetchFonts = async () => {
    try {
      const res = await fetch("/api/fonts");
      const data = await res.json();
      
      const loadedFonts = await Promise.all(data.map(async (font: Font) => {
        // Clean font name: remove timestamp prefix and extension
        const parts = font.name.split('-');
        const nameWithExt = parts.length > 1 ? parts.slice(1).join('-') : font.name;
        const fontFamily = nameWithExt.split('.').slice(0, -1).join('.');
        
        const fontFace = new FontFace(fontFamily, `url("${encodeURI(font.url)}")`);
        try {
          const loadedFace = await fontFace.load();
          document.fonts.add(loadedFace);
          return { name: fontFamily, url: font.url };
        } catch (e) {
          console.error(`Failed to load font: ${font.name}`, e);
          return null;
        }
      }));
      
      setFonts(loadedFonts.filter(f => f !== null) as Font[]);
    } catch (err) {
      console.error("Failed to fetch fonts", err);
    }
  };

  const fetchProjects = async () => {
    if (!user) return;
    try {
      const res = await fetch(`/api/images?username=${user.username}`);
      const data = await res.json();
      setProjects(data);
      
      // Auto-select the last edited project
      if (data.length > 0 && !currentProjectId) {
        const lastProject = [...data].sort((a, b) => {
          const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return timeB - timeA;
        })[0];
        if (lastProject) loadProject(lastProject);
      }
    } catch (err) {
      console.error("Failed to fetch projects", err);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (data.success) {
        setUser({ username: data.username, role: data.role, selectedFonts: data.selectedFonts });
      } else {
        setError(data.message);
      }
    } catch (err) {
      setError("Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      alert("Passwords do not match");
      return;
    }
    try {
      const res = await fetch("/api/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          username: user?.username, 
          oldPassword, 
          newPassword 
        }),
      });
      const data = await res.json();
      if (data.success) {
        alert("Password changed successfully");
        setShowChangePasswordModal(false);
        setOldPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        alert(data.message);
      }
    } catch (err) {
      console.error("Failed to change password", err);
    }
  };

  const fetchAllUsers = async () => {
    if (!user || user.role !== 'admin') return;
    try {
      const res = await fetch(`/api/v1/update`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          'x-sync-auth': btoa(user.username) 
        },
        body: JSON.stringify({ a: 'l' })
      });
      if (!res.ok) {
        const text = await res.text();
        console.error(`Fetch users failed with status ${res.status}:`, text);
        throw new Error(`Server returned ${res.status}`);
      }
      const data = await res.json();
      if (data.success) {
        setAllUsers(data.users);
      } else {
        console.error("Fetch users failed:", data.message);
      }
    } catch (err) {
      console.error("Failed to fetch users", err);
    }
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || user.role !== 'admin' || !editingUser) return;
    try {
      const res = await fetch(`/api/v1/update`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "x-sync-auth": btoa(user.username)
        },
        body: JSON.stringify({ 
          a: 'u',
          id: editingUser.username,
          c: userManagementPassword,
          t: editingUser.role
        }),
      });
      const data = await res.json();
      if (data.success) {
        alert("User updated successfully");
        setEditingUser(null);
        setUserManagementPassword("");
        fetchAllUsers();
      } else {
        alert(data.message || "Failed to update user");
      }
    } catch (err) {
      console.error("Failed to update user", err);
      alert("Failed to update user");
    }
  };

  const handleDeleteUser = async (usernameToDelete: string) => {
    if (!user || user.role !== 'admin') return;
    if (!confirm(`Are you sure you want to delete user ${usernameToDelete}?`)) return;
    try {
      const res = await fetch(`/api/v1/update`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "x-sync-auth": btoa(user.username)
        },
        body: JSON.stringify({ 
          a: 'd',
          id: usernameToDelete
        }),
      });
      const data = await res.json();
      if (data.success) {
        fetchAllUsers();
      } else {
        alert(data.message || "Failed to delete user");
      }
    } catch (err) {
      console.error("Failed to delete user", err);
      alert("Failed to delete user");
    }
  };

  const saveProject = async () => {
    if (!user || !image) return;
    setIsSaving(true);
    const projectId = currentProjectId || Math.random().toString(36).substr(2, 9);
    
    // Find existing project to preserve its name and createdAt
    // We check both the projects state and the currentProjectId
    const existingProject = projects.find(p => p.id === projectId);
    
    // If we can't find it in projects, it might have been JUST created
    // So we use a default only if it's truly a new project
    const projectName = existingProject ? existingProject.name : (currentProjectId ? `Project ${new Date().toLocaleDateString()}` : `New Project`);

    const project: ImageProject = {
      id: projectId,
      username: user.username,
      imageUrl: image,
      layers,
      name: projectName,
      createdAt: existingProject?.createdAt || new Date().toISOString(),
    };

    try {
      const res = await fetch("/api/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(project),
      });
      if (res.ok) {
        setCurrentProjectId(projectId);
        await fetchProjects();
      } else {
        console.error("Failed to save project:", await res.text());
      }
    } catch (err) {
      console.error("Failed to save project", err);
    } finally {
      setIsSaving(false);
    }
  };

  const deleteProject = (id: string) => {
    setProjectToDeleteId(id);
  };

  const confirmDeleteProject = async () => {
    if (!projectToDeleteId) return;
    try {
      const res = await fetch(`/api/images/${projectToDeleteId}`, { method: "DELETE" });
      if (res.ok) {
        if (currentProjectId === projectToDeleteId) {
          setCurrentProjectId(null);
          setImage(null);
          setLayers([]);
        }
        await fetchProjects();
      }
    } catch (err) {
      console.error("Failed to delete project", err);
    } finally {
      setProjectToDeleteId(null);
    }
  };

  const loadProject = (project: ImageProject) => {
    setCurrentProjectId(project.id);
    setImage(project.imageUrl);
    setLayers(project.layers.map(l => ({ ...l, name: l.name || l.text })));
    setSelectedLayerId(null);
  };

  const onDrop = async (acceptedFiles: File[]) => {
    console.log("onDrop triggered with files:", acceptedFiles.map(f => f.name));
    if (!acceptedFiles.length) {
      console.warn("onDrop: No files accepted by dropzone");
      return;
    }
    
    if (!user) {
      console.error("onDrop: User is not logged in, cannot upload");
      alert("Please sign in to upload images.");
      return;
    }

    setLoading(true); // Show loading state during upload
    try {
      for (const file of acceptedFiles) {
        console.log(`Starting upload for: ${file.name} (${file.size} bytes)`);
        const formData = new FormData();
        formData.append("image", file);

        const res = await fetch("/api/upload-image", {
          method: "POST",
          body: formData,
        });
        
        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(`Upload failed for ${file.name}: ${res.status} ${errorText}`);
        }
        
        const data = await res.json();
        
        if (data.success) {
          console.log(`Upload successful for ${file.name}, URL: ${data.url}`);
          const projectId = Math.random().toString(36).substr(2, 9);
          const fileName = file.name.split('.').slice(0, -1).join('.') || file.name;
          
          const project: ImageProject = {
            id: projectId,
            username: user.username,
            imageUrl: data.url,
            layers: [],
            name: fileName,
            createdAt: new Date().toISOString(),
          };

          console.log(`Saving project metadata for ${file.name}...`);
          const saveRes = await fetch("/api/images", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(project),
          });
          
          if (!saveRes.ok) {
            console.error(`Failed to save project metadata for ${file.name}`);
          } else {
            console.log(`Project metadata saved for ${file.name}`);
          }
          
          // If it's the last one, load it
          if (file === acceptedFiles[acceptedFiles.length - 1]) {
            console.log(`Loading last uploaded image: ${file.name}`);
            setImage(data.url);
            setLayers([]);
            setCurrentProjectId(projectId);
            setSelectedLayerId(null);
            // We update projects state locally to avoid the race condition with auto-save
            setProjects(prev => [project, ...prev]);
          }
        } else {
          throw new Error(`Upload failed for ${file.name}: ${data.message || 'Unknown error'}`);
        }
      }
    } catch (err) {
      console.error("Critical upload error:", err);
      alert(err instanceof Error ? err.message : "An error occurred during upload.");
    } finally {
      setLoading(false);
      await fetchProjects();
    }
  };

  const { getRootProps: getSidebarRootProps, getInputProps: getSidebarInputProps, isDragActive: isSidebarDragActive } = useDropzone({
    onDrop,
    onDropRejected: (fileRejections) => {
      console.error("Sidebar files rejected:", fileRejections);
      alert("Some files were rejected. Please upload only images.");
    },
    accept: { "image/*": [] },
    multiple: true,
  } as any);

  const { getRootProps: getMainRootProps, getInputProps: getMainInputProps, isDragActive: isMainDragActive } = useDropzone({
    onDrop,
    onDropRejected: (fileRejections) => {
      console.error("Main area files rejected:", fileRejections);
      alert("Some files were rejected. Please upload only images.");
    },
    accept: { "image/*": [] },
    multiple: true,
  } as any);

  const handleFontUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsFontLoading(true);
    const formData = new FormData();
    formData.append("font", file);

    try {
      const res = await fetch("/api/upload-font", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error(`Font upload failed: ${res.status}`);
      const data = await res.json();
      if (data.success) {
        await fetchFonts();
      }
    } catch (err) {
      console.error("Font upload failed:", err);
    } finally {
      setIsFontLoading(false);
    }
  };

  const deleteFont = async (fontName: string) => {
    try {
      const res = await fetch(`/api/fonts/${fontName}`, { method: "DELETE" });
      if (res.ok) {
        await fetchFonts();
      }
    } catch (err) {
      console.error("Failed to delete font", err);
    }
  };

  const renameFont = async (oldName: string) => {
    const newName = prompt("Enter new name for the font:", oldName);
    if (!newName || newName === oldName) return;
    try {
      const res = await fetch("/api/fonts/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldName, newName }),
      });
      if (res.ok) {
        await fetchFonts();
      }
    } catch (err) {
      console.error("Failed to rename font", err);
    }
  };

  const renameProject = async (id: string, newName: string) => {
    const project = projects.find(p => p.id === id);
    if (!project || project.name === newName) return;
    
    try {
      const res = await fetch("/api/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...project, name: newName }),
      });
      if (res.ok) {
        await fetchProjects();
      }
    } catch (err) {
      console.error("Failed to rename project", err);
    }
  };

  const updatePreferences = async (selectedFonts: string[]) => {
    if (!user) return;
    try {
      const res = await fetch("/api/user/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user.username, selectedFonts }),
      });
      if (res.ok) {
        setUser({ ...user, selectedFonts });
      }
    } catch (err) {
      console.error("Failed to update preferences", err);
    }
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || user.role !== 'admin') return;
    setIsCreatingAccount(true);
    try {
      const res = await fetch("/api/v1/update", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "x-sync-auth": btoa(user.username)
        },
        body: JSON.stringify({ 
          a: 'c',
          id: newAccountUsername,
          c: newAccountPassword,
          t: 'user'
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        console.error(`Create account failed with status ${res.status}:`, text);
        throw new Error(`Server returned ${res.status}`);
      }
      const data = await res.json();
      if (data.success) {
        setNewAccountUsername("");
        setNewAccountPassword("");
        await fetchAllUsers();
        alert("Account created successfully!");
      } else {
        alert(data.message || "Failed to create account");
      }
    } catch (err) {
      console.error("Failed to create account", err);
      alert("Failed to create account");
    } finally {
      setIsCreatingAccount(false);
    }
  };

  const addLayer = () => {
    const newLayer: TextLayer = {
      id: Math.random().toString(36).substr(2, 9),
      name: `Text Layer ${layers.length + 1}`,
      text: "New Text Layer",
      x: 50,
      y: 50,
      fontSize: 60,
      color: "#001EB4",
      fontFamily: fonts[0]?.name || "sans-serif",
      strokeColor: "#000000",
      strokeWidth: 0,
      shadowBlur: 0,
      shadowColor: "#000000",
      textAlign: 'left',
      type: 'text',
    };
    setLayers([...layers, newLayer]);
    setSelectedLayerId(newLayer.id);
  };

  const addDateLayer = () => {
    const today = new Date().toISOString().split('T')[0];
    const newLayer: TextLayer = {
      id: Math.random().toString(36).substr(2, 9),
      name: `Date Layer ${layers.length + 1}`,
      text: today,
      x: 50,
      y: 50,
      fontSize: 60,
      color: "#001EB4",
      fontFamily: fonts[0]?.name || "sans-serif",
      strokeColor: "#000000",
      strokeWidth: 0,
      shadowBlur: 0,
      shadowColor: "#000000",
      textAlign: 'left',
      type: 'date',
    };
    setLayers([...layers, newLayer]);
    setSelectedLayerId(newLayer.id);
  };

  const updateLayer = (id: string, updates: Partial<TextLayer>) => {
    setLayers(layers.map((l) => (l.id === id ? { ...l, ...updates } : l)));
  };

  const deleteLayer = (id: string) => {
    setLayers(layers.filter((l) => l.id !== id));
    if (selectedLayerId === id) setSelectedLayerId(null);
  };

  const drawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.src = image;
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      layers.forEach((layer) => {
        ctx.save();
        ctx.font = `${layer.fontSize}px "${layer.fontFamily}"`;
        ctx.textAlign = layer.textAlign || "center";
        ctx.textBaseline = "middle";
        
        const x = (layer.x / 100) * canvas.width;
        const y = (layer.y / 100) * canvas.height;

        if (layer.shadowBlur > 0) {
          ctx.shadowBlur = layer.shadowBlur;
          ctx.shadowColor = layer.shadowColor;
        }

        if (layer.strokeWidth > 0) {
          ctx.strokeStyle = layer.strokeColor;
          ctx.lineWidth = layer.strokeWidth;
          ctx.strokeText(layer.text, x, y);
        }

        ctx.fillStyle = layer.color;
        ctx.fillText(layer.text, x, y);
        ctx.restore();
      });
    };
  };

  useEffect(() => {
    drawCanvas();
  }, [image, layers]);

  // Auto-save effect
  useEffect(() => {
    if (!user || !image) return;
    
    const timer = setTimeout(() => {
      saveProject();
    }, 1000); // Debounce save for 1 second

    return () => clearTimeout(timer);
  }, [layers, image]);

  const getLayerAtPosition = (mouseX: number, mouseY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    return [...layers].reverse().find((layer) => {
      ctx.font = `${layer.fontSize}px "${layer.fontFamily}"`;
      const metrics = ctx.measureText(layer.text);
      const x = (layer.x / 100) * canvas.width;
      const y = (layer.y / 100) * canvas.height;
      
      const width = metrics.width;
      const height = layer.fontSize;
      
      let startX = x - width / 2;
      if (layer.textAlign === 'left') startX = x;
      if (layer.textAlign === 'right') startX = x - width;

      return (
        mouseX >= startX &&
        mouseX <= startX + width &&
        mouseY >= y - height / 2 &&
        mouseY <= y + height / 2
      );
    });
  };

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;

    const clickedLayer = getLayerAtPosition(mouseX, mouseY);

    if (clickedLayer) {
      setSelectedLayerId(clickedLayer.id);
      isDraggingRef.current = true;
      dragStartPos.current = {
        x: mouseX - (clickedLayer.x / 100) * canvas.width,
        y: mouseY - (clickedLayer.y / 100) * canvas.height,
      };
    } else {
      setSelectedLayerId(null);
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;

    if (isDraggingRef.current && selectedLayerId) {
      const newX = ((mouseX - dragStartPos.current.x) / canvas.width) * 100;
      const newY = ((mouseY - dragStartPos.current.y) / canvas.height) * 100;
      updateLayer(selectedLayerId, { x: newX, y: newY });
      canvas.style.cursor = 'move';
    } else {
      const hoveredLayer = getLayerAtPosition(mouseX, mouseY);
      canvas.style.cursor = hoveredLayer ? 'move' : 'default';
    }
  };

  const handleCanvasMouseUp = () => {
    isDraggingRef.current = false;
  };

  const downloadImage = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = "overlay-image.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-slate-900 border border-slate-800 p-8 rounded-2xl w-full max-w-md shadow-2xl"
        >
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-blue-900/20">
              <ImageIcon className="text-white w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold text-white">FontOverlay Pro</h1>
            <p className="text-slate-400 text-sm">Sign in to start creating</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                placeholder="admin"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                placeholder="••••"
                required
              />
            </div>
            {error && <p className="text-red-400 text-sm text-center">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 rounded-xl transition-colors shadow-lg shadow-blue-900/20 flex items-center justify-center gap-2"
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>
          <p className="mt-6 text-center text-slate-500 text-xs">
            Default credentials: <span className="text-slate-400">admin / 1234</span>
          </p>
        </motion.div>
      </div>
    );
  }

  const selectedLayer = layers.find((l) => l.id === selectedLayerId);

  return (
    <div className="h-screen bg-slate-950 text-slate-200 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="h-16 border-b border-slate-800 flex items-center justify-between px-6 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <ImageIcon className="text-white w-5 h-5" />
          </div>
          <span className="font-bold text-lg tracking-tight">FontOverlay Pro</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-slate-800 rounded-lg px-3 py-1.5">
            <button onClick={() => setZoom(Math.max(0.1, zoom - 0.1))} className="hover:text-blue-400">-</button>
            <span className="text-xs font-mono w-12 text-center">{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom(Math.min(3, zoom + 0.1))} className="hover:text-blue-400">+</button>
          </div>
          
          <div className="relative">
            <button 
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 rounded-lg px-3 py-1.5 transition-all"
            >
              <UserCircle size={18} className="text-blue-400" />
              <span className="text-sm font-medium">{user.username}</span>
              <ChevronDown size={14} className={cn("transition-transform", showUserMenu && "rotate-180")} />
            </button>

            <AnimatePresence>
              {showUserMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className="absolute right-0 mt-2 w-56 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl z-50 overflow-hidden"
                  >
                    <div className="p-3 border-b border-slate-800">
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Account</p>
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-blue-600/20 rounded-full flex items-center justify-center">
                          <span className="text-blue-400 font-bold text-sm">{user.username[0].toUpperCase()}</span>
                        </div>
                        <div>
                          <p className="text-sm font-bold text-white">{user.username}</p>
                          <p className="text-[10px] text-slate-500 flex items-center gap-1">
                            {user.role === 'admin' ? <Shield size={10} /> : <UserCircle size={10} />}
                            {user.role.toUpperCase()}
                          </p>
                        </div>
                      </div>
                    </div>
                    
                    <div className="p-1">
                      <button 
                        onClick={() => {
                          setShowUserMenu(false);
                          setShowChangePasswordModal(true);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white rounded-lg transition-colors"
                      >
                        <Key size={16} />
                        Change Password
                      </button>
                      
                      <button 
                        onClick={() => {
                          setShowUserMenu(false);
                          setShowFontManagementModal(true);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white rounded-lg transition-colors"
                      >
                        <FontIcon size={16} />
                        Manage Fonts
                      </button>

                      {user.role === 'admin' && (
                        <>
                          <button 
                            onClick={() => {
                              setShowUserMenu(false);
                              fetchAllUsers();
                              setShowUserManagementModal(true);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white rounded-lg transition-colors"
                          >
                            <Users size={16} />
                            Manage Users
                          </button>
                        </>
                      )}
                    </div>
                    
                    <div className="p-1 border-t border-slate-800">
                      <button 
                        onClick={() => setUser(null)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                      >
                        <LogOut size={16} />
                        Sign Out
                      </button>
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      <AnimatePresence>
        {showChangePasswordModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-900 border border-slate-800 p-6 rounded-2xl w-full max-w-sm shadow-2xl"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold text-white">Change Password</h3>
                <button onClick={() => setShowChangePasswordModal(false)} className="text-slate-500 hover:text-white">
                  <Plus size={20} className="rotate-45" />
                </button>
              </div>
              <form onSubmit={handleChangePassword} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Old Password</label>
                  <input
                    type="password"
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    placeholder="Enter old password"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">New Password</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    placeholder="Enter new password"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Confirm New Password</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    placeholder="Confirm new password"
                    required
                  />
                </div>
                <button
                  type="submit"
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-blue-900/20"
                >
                  Update Password
                </button>
              </form>
            </motion.div>
          </div>
        )}

        {showFontManagementModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-900 border border-slate-800 p-6 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="flex items-center justify-between mb-6 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-600/20 rounded-xl flex items-center justify-center">
                    <FontIcon size={20} className="text-blue-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white leading-tight">Font Management</h3>
                    <p className="text-xs text-slate-500">Select, order and manage custom fonts</p>
                  </div>
                </div>
                <button onClick={() => setShowFontManagementModal(false)} className="text-slate-500 hover:text-white transition-colors">
                  <Plus size={24} className="rotate-45" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-6">
                {/* Upload Section */}
                <div className="bg-slate-800/30 border border-slate-800 p-4 rounded-xl">
                  <h4 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                    <Upload size={16} className="text-green-400" />
                    Upload New Font
                  </h4>
                  <div className="flex items-center gap-4">
                    <label className="flex-1 cursor-pointer bg-slate-900 border border-slate-700 border-dashed rounded-xl p-6 hover:border-blue-500 hover:bg-blue-500/5 transition-all text-center group">
                      <input type="file" accept=".ttf,.otf,.woff,.woff2" className="hidden" onChange={handleFontUpload} />
                      <div className="flex flex-col items-center gap-2">
                        <Plus size={24} className="text-slate-500 group-hover:text-blue-400 transition-colors" />
                        <span className="text-sm text-slate-400 group-hover:text-slate-300">Click to browse font files</span>
                        <span className="text-[10px] text-slate-600 uppercase tracking-widest">TTF, OTF, WOFF, WOFF2</span>
                      </div>
                    </label>
                    {isFontLoading && (
                      <div className="w-12 h-12 border-2 border-blue-500/20 border-t-blue-500 rounded-full animate-spin shrink-0" />
                    )}
                  </div>
                </div>

                {/* Font List Section */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Installed Fonts</h4>
                  <div className="grid grid-cols-1 gap-2">
                    {fonts.length === 0 ? (
                      <div className="text-center py-8 bg-slate-800/20 rounded-xl border border-slate-800 border-dashed">
                        <p className="text-sm text-slate-500 italic">No custom fonts installed</p>
                      </div>
                    ) : (
                      fonts.map((f, index) => {
                        const isSelected = user?.selectedFonts?.includes(f.name);
                        const selectedIndex = user?.selectedFonts?.indexOf(f.name) ?? -1;
                        
                        return (
                          <div key={`${f.name}-${index}`} className="bg-slate-800/30 border border-slate-800 p-3 rounded-xl flex items-center justify-between group">
                            <div className="flex items-center gap-3">
                              <button 
                                onClick={() => {
                                  const currentSelected = user?.selectedFonts || [];
                                  if (isSelected) {
                                    updatePreferences(currentSelected.filter(name => name !== f.name));
                                  } else {
                                    updatePreferences([...currentSelected, f.name]);
                                  }
                                }}
                                className={cn(
                                  "w-6 h-6 rounded border flex items-center justify-center transition-all",
                                  isSelected ? "bg-blue-600 border-blue-500 text-white" : "bg-slate-900 border-slate-700 text-transparent"
                                )}
                              >
                                <Plus size={14} className={cn(isSelected ? "" : "opacity-0")} />
                              </button>
                              <div className="w-10 h-10 bg-slate-800 rounded-lg flex items-center justify-center">
                                <span className="text-slate-400 font-bold text-lg" style={{ fontFamily: f.name }}>Aa</span>
                              </div>
                              <div>
                                <p className="text-sm font-bold text-white">{f.name}</p>
                                <p className="text-[10px] text-slate-500 uppercase tracking-widest">
                                  {isSelected ? `Selected (Position: ${selectedIndex + 1})` : 'Not Selected'}
                                </p>
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-2">
                              {isSelected && (
                                <div className="flex gap-1 mr-2">
                                  <button 
                                    disabled={selectedIndex === 0}
                                    onClick={() => {
                                      const currentSelected = [...(user?.selectedFonts || [])];
                                      if (selectedIndex > 0) {
                                        [currentSelected[selectedIndex - 1], currentSelected[selectedIndex]] = [currentSelected[selectedIndex], currentSelected[selectedIndex - 1]];
                                        updatePreferences(currentSelected);
                                      }
                                    }}
                                    className="p-1.5 hover:bg-slate-700 text-slate-400 rounded disabled:opacity-30"
                                  >
                                    <ChevronDown size={14} className="rotate-180" />
                                  </button>
                                  <button 
                                    disabled={selectedIndex === (user?.selectedFonts?.length || 0) - 1}
                                    onClick={() => {
                                      const currentSelected = [...(user?.selectedFonts || [])];
                                      if (selectedIndex < currentSelected.length - 1) {
                                        [currentSelected[selectedIndex + 1], currentSelected[selectedIndex]] = [currentSelected[selectedIndex], currentSelected[selectedIndex + 1]];
                                        updatePreferences(currentSelected);
                                      }
                                    }}
                                    className="p-1.5 hover:bg-slate-700 text-slate-400 rounded disabled:opacity-30"
                                  >
                                    <ChevronDown size={14} />
                                  </button>
                                </div>
                              )}

                              {user?.role === 'admin' && (
                                <>
                                  <button 
                                    onClick={() => {
                                      setEditingFont(f);
                                      setNewFontName(f.name);
                                    }}
                                    className="p-2 hover:bg-blue-600/20 text-slate-400 hover:text-blue-400 rounded-lg transition-all"
                                    title="Rename Font"
                                  >
                                    <Edit2 size={16} />
                                  </button>
                                  <button 
                                    onClick={() => {
                                      if (confirm(`Are you sure you want to delete the font "${f.name}"?`)) {
                                        deleteFont(f.name);
                                      }
                                    }}
                                    className="p-2 hover:bg-red-600/20 text-slate-400 hover:text-red-400 rounded-lg transition-all"
                                    title="Delete Font"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>

              {/* Rename Font Modal Overlay */}
              <AnimatePresence>
                {editingFont && (
                  <div className="absolute inset-0 z-[110] flex items-center justify-center p-6 bg-slate-950/90 backdrop-blur-md rounded-2xl">
                    <div className="w-full max-w-sm space-y-6">
                      <div className="flex items-center justify-between">
                        <h4 className="text-lg font-bold text-white">Rename Font: {editingFont.name}</h4>
                        <button onClick={() => setEditingFont(null)} className="text-slate-500 hover:text-white">
                          <Plus size={20} className="rotate-45" />
                        </button>
                      </div>
                      <div className="space-y-4">
                        <div>
                          <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">New Font Name</label>
                          <input
                            type="text"
                            value={newFontName}
                            onChange={(e) => setNewFontName(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-white outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                            placeholder="Enter new name"
                          />
                        </div>
                        <div className="flex gap-3">
                          <button
                            onClick={() => setEditingFont(null)}
                            className="flex-1 bg-slate-800 hover:bg-slate-700 text-white font-bold py-2.5 rounded-xl transition-all"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={async () => {
                              if (!newFontName || newFontName === editingFont.name) return;
                              try {
                                const res = await fetch("/api/fonts/rename", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ oldName: editingFont.name, newName: newFontName }),
                                });
                                if (res.ok) {
                                  await fetchFonts();
                                  setEditingFont(null);
                                }
                              } catch (err) {
                                console.error("Failed to rename font", err);
                              }
                            }}
                            className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-bold py-2.5 rounded-xl transition-all"
                          >
                            Save Changes
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </AnimatePresence>
            </motion.div>
          </div>
        )}

        {showUserManagementModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-900 border border-slate-800 p-6 rounded-2xl w-full max-w-2xl shadow-2xl max-h-[80vh] flex flex-col"
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <Users className="text-blue-400" />
                  <h3 className="text-lg font-bold text-white">User Management</h3>
                </div>
                <button onClick={() => setShowUserManagementModal(false)} className="text-slate-500 hover:text-white">
                  <Plus size={20} className="rotate-45" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-6 pr-2 custom-scrollbar">
                {/* Create New User Section */}
                <div className="bg-slate-800/50 border border-slate-800 p-4 rounded-xl">
                  <h4 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                    <UserPlus size={16} className="text-green-400" />
                    Create New User
                  </h4>
                  <form onSubmit={handleCreateAccount} className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <input
                        type="text"
                        value={newAccountUsername}
                        onChange={(e) => setNewAccountUsername(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-blue-500 transition-all"
                        placeholder="Username"
                        required
                      />
                    </div>
                    <div>
                      <input
                        type="password"
                        value={newAccountPassword}
                        onChange={(e) => setNewAccountPassword(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-blue-500 transition-all"
                        placeholder="Password"
                        required
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={isCreatingAccount}
                      className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 rounded-lg text-sm transition-all"
                    >
                      {isCreatingAccount ? "Creating..." : "Add User"}
                    </button>
                  </form>
                </div>

                {/* User List Section */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Existing Users</h4>
                  <div className="grid grid-cols-1 gap-2">
                    {allUsers.map((u, index) => (
                      <div key={`${u.username}-${index}`} className="bg-slate-800/30 border border-slate-800 p-3 rounded-xl flex items-center justify-between group">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-slate-800 rounded-full flex items-center justify-center">
                            <span className="text-slate-400 font-bold">{u.username[0].toUpperCase()}</span>
                          </div>
                          <div>
                            <p className="text-sm font-bold text-white flex items-center gap-2">
                              {u.username}
                              {u.role === 'admin' && <Shield size={12} className="text-blue-400" />}
                            </p>
                            <p className="text-[10px] text-slate-500 uppercase tracking-widest">{u.role}</p>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => setEditingUser(u)}
                            className="p-2 hover:bg-blue-600/20 text-slate-400 hover:text-blue-400 rounded-lg transition-all"
                            title="Edit User"
                          >
                            <Edit2 size={16} />
                          </button>
                          {u.username !== 'admin' && (
                            <button 
                              onClick={() => handleDeleteUser(u.username)}
                              className="p-2 hover:bg-red-600/20 text-slate-400 hover:text-red-400 rounded-lg transition-all"
                              title="Delete User"
                            >
                              <UserMinus size={16} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Edit User Modal Overlay */}
              <AnimatePresence>
                {editingUser && (
                  <div className="absolute inset-0 z-[110] flex items-center justify-center p-6 bg-slate-950/90 backdrop-blur-md rounded-2xl">
                    <div className="w-full max-w-sm space-y-6">
                      <div className="flex items-center justify-between">
                        <h4 className="text-lg font-bold text-white">Edit User: {editingUser.username}</h4>
                        <button onClick={() => setEditingUser(null)} className="text-slate-500 hover:text-white">
                          <Plus size={20} className="rotate-45" />
                        </button>
                      </div>
                      <form onSubmit={handleUpdateUser} className="space-y-4">
                        <div>
                          <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">New Password (leave blank to keep current)</label>
                          <input
                            type="password"
                            value={userManagementPassword}
                            onChange={(e) => setUserManagementPassword(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-white outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                            placeholder="Enter new password"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Role</label>
                          <select
                            value={editingUser.role}
                            onChange={(e) => setEditingUser({ ...editingUser, role: e.target.value as 'admin' | 'user' })}
                            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-white outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                            disabled={editingUser.username === 'admin'}
                          >
                            <option value="user">User</option>
                            <option value="admin">Admin</option>
                          </select>
                        </div>
                        <div className="flex gap-3 pt-2">
                          <button
                            type="button"
                            onClick={() => setEditingUser(null)}
                            className="flex-1 bg-slate-800 hover:bg-slate-700 text-white font-bold py-3 rounded-xl transition-all"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-blue-900/20"
                          >
                            Save Changes
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>
                )}
              </AnimatePresence>
            </motion.div>
          </div>
        )}

        {projectToDeleteId && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-slate-900 border border-slate-800 p-6 rounded-2xl w-full max-w-sm shadow-2xl"
            >
              <h3 className="text-lg font-bold text-white mb-2">Delete Project?</h3>
              <p className="text-slate-400 text-sm mb-6">This action cannot be undone. Are you sure you want to delete this project?</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setProjectToDeleteId(null)}
                  className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-all font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDeleteProject}
                  className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl transition-all font-medium"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar Left - Layers & Controls */}
        <aside className="w-80 border-r border-slate-800 bg-slate-900 flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-800 space-y-2 shrink-0">
            <div
              {...getSidebarRootProps()}
              className={cn(
                "w-full border-2 border-dashed rounded-lg py-2 flex flex-col items-center justify-center transition-all cursor-pointer text-xs",
                isSidebarDragActive ? "border-blue-500 bg-blue-500/5" : "border-slate-800 hover:border-slate-700 bg-slate-800/50"
              )}
            >
              <input {...getSidebarInputProps()} />
              <span className="text-slate-400">Upload New Image(s)</span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {/* Projects Section */}
            <div className="border-b border-slate-800">
              <div className="p-4 pb-2">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">My Projects</h3>
              </div>
              <div className="p-4 pt-0">
                <div className="grid grid-cols-2 gap-2">
                  {projects.length === 0 ? (
                    <p className="text-[10px] text-slate-600 italic col-span-2 text-center py-4">No projects yet</p>
                  ) : (
                    projects.map((proj) => (
                      <div
                        key={proj.id}
                        onClick={() => loadProject(proj)}
                        className={cn(
                          "relative aspect-square rounded-lg overflow-hidden cursor-pointer border-2 transition-all group",
                          currentProjectId === proj.id ? "border-blue-500" : "border-transparent hover:border-slate-700"
                        )}
                      >
                        <img src={proj.imageUrl} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        
                        {/* Delete Button Overlay */}
                        <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteProject(proj.id);
                            }}
                            className="p-1 bg-red-600/80 hover:bg-red-600 rounded text-white backdrop-blur-sm shadow-lg"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>

                        {/* Name Overlay */}
                        <div className="absolute bottom-0 left-0 right-0 p-1.5 bg-black/60 backdrop-blur-md">
                          <input
                            type="text"
                            defaultValue={proj.name}
                            onClick={(e) => e.stopPropagation()}
                            onBlur={(e) => renameProject(proj.id, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                (e.target as HTMLInputElement).blur();
                              }
                            }}
                            className="w-full bg-transparent text-[10px] text-white outline-none border-none p-0 text-center font-medium"
                          />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Layers & Properties Section */}
            <div className="p-4 space-y-4">
              <div>
                <div className="grid grid-cols-2 gap-2 mb-4">
                  <button
                    onClick={addLayer}
                    disabled={!image}
                    className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2 rounded-lg flex items-center justify-center gap-2 transition-all text-xs"
                  >
                    <Plus size={14} /> Add Text
                  </button>
                  <button
                    onClick={addDateLayer}
                    disabled={!image}
                    className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2 rounded-lg flex items-center justify-center gap-2 transition-all text-xs"
                  >
                    <Calendar size={14} /> Add Date
                  </button>
                </div>
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Layers</h3>
                <div className="space-y-2">
                  {layers.length === 0 ? (
                    <p className="text-sm text-slate-600 italic text-center py-4">No layers yet</p>
                  ) : (
                    layers.map((layer) => (
                      <div
                        key={layer.id}
                        onClick={() => setSelectedLayerId(layer.id)}
                        className={cn(
                          "group flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all border",
                          selectedLayerId === layer.id
                            ? "bg-blue-600/10 border-blue-600/50 text-blue-400"
                            : "bg-slate-800/50 border-transparent hover:bg-slate-800 text-slate-400"
                        )}
                      >
                        <div className="flex flex-col gap-1 overflow-hidden flex-1">
                          <div className="flex items-center gap-2">
                            <Type size={12} className="shrink-0 opacity-50" />
                            <input
                              type="text"
                              value={layer.name}
                              onChange={(e) => updateLayer(layer.id, { name: e.target.value })}
                              onClick={(e) => e.stopPropagation()}
                              placeholder="Layer Name"
                              className="bg-transparent border-none outline-none text-[10px] font-bold uppercase tracking-wider w-full p-0 text-inherit placeholder:text-slate-600"
                            />
                          </div>
                          <input
                            type="text"
                            value={layer.text}
                            onChange={(e) => updateLayer(layer.id, { text: e.target.value })}
                            onClick={(e) => e.stopPropagation()}
                            placeholder="Content"
                            className="bg-transparent border-none outline-none text-sm w-full p-0 text-inherit opacity-80 placeholder:text-slate-600"
                          />
                        </div>
                        <div className="flex items-center gap-1">
                          {layer.type === 'date' && (
                            <div className="relative group/date">
                              <button
                                className="p-1 hover:text-blue-400 transition-all opacity-0 group-hover:opacity-100"
                              >
                                <Calendar size={14} />
                              </button>
                              <input
                                type="date"
                                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => {
                                  if (e.target.value) {
                                    updateLayer(layer.id, { text: e.target.value });
                                  }
                                }}
                              />
                            </div>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteLayer(layer.id);
                            }}
                            className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 transition-all"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {selectedLayer && (
                <div className="pt-4 border-t border-slate-800 space-y-4">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Properties</h3>
                <div className="space-y-4">
                  <div>
                    <label className="text-xs text-slate-500 block mb-1.5">Layer Name</label>
                    <input
                      type="text"
                      value={selectedLayer.name}
                      onChange={(e) => updateLayer(selectedLayer.id, { name: e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 block mb-1.5">Text Content</label>
                    <textarea
                      value={selectedLayer.text}
                      onChange={(e) => updateLayer(selectedLayer.id, { text: e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500 resize-none h-20"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs text-slate-500 block">Font Family</label>
                      <label className="cursor-pointer text-blue-500 hover:text-blue-400 transition-colors flex items-center gap-1">
                        <Plus size={12} />
                        <span className="text-[10px] font-bold uppercase tracking-wider">Upload</span>
                        <input type="file" accept=".ttf,.otf,.woff,.woff2" className="hidden" onChange={handleFontUpload} />
                      </label>
                    </div>
                    
                    <div className="relative">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          const dropdown = document.getElementById('font-dropdown');
                          if (dropdown) dropdown.classList.toggle('hidden');
                        }}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-left flex justify-between items-center hover:border-slate-600 transition-all outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        <span className="truncate">{selectedLayer.fontFamily}</span>
                        <Plus size={14} className="rotate-45 opacity-50" />
                      </button>
                      
                      <div 
                        id="font-dropdown"
                        className="hidden absolute z-[100] w-full mt-1 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl max-h-64 overflow-y-auto"
                      >
                        <div 
                          className="px-3 py-2.5 hover:bg-blue-600/20 cursor-pointer border-b border-slate-800/50 transition-colors"
                          onClick={() => {
                            updateLayer(selectedLayer.id, { fontFamily: 'sans-serif' });
                            document.getElementById('font-dropdown')?.classList.add('hidden');
                          }}
                        >
                          <span className="font-sans text-xs text-slate-400 block mb-1 uppercase tracking-tighter">System Sans</span>
                          <span className="font-sans text-lg">Preview</span>
                        </div>
                        {(user?.selectedFonts && user.selectedFonts.length > 0 
                          ? user.selectedFonts.map(name => fonts.find(f => f.name === name)).filter(Boolean) as Font[]
                          : fonts
                        ).map((f, index) => (
                          <div 
                            key={`${f.name}-${index}`}
                            className="px-3 py-2.5 hover:bg-blue-600/20 cursor-pointer border-b border-slate-800/50 transition-colors group/font"
                            onClick={() => {
                              updateLayer(selectedLayer.id, { fontFamily: f.name });
                              document.getElementById('font-dropdown')?.classList.add('hidden');
                            }}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-sans text-xs text-slate-400 block uppercase tracking-tighter">{f.name}</span>
                            </div>
                            <span style={{ fontFamily: f.name }} className="text-lg">
                              Preview
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {isFontLoading && (
                      <div className="mt-2 flex items-center gap-2 text-[10px] text-blue-400">
                        <div className="w-2 h-2 border border-blue-400 border-t-transparent rounded-full animate-spin"></div>
                        <span>Uploading font...</span>
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-500 block mb-1.5">Size</label>
                      <input
                        type="number"
                        value={selectedLayer.fontSize}
                        onChange={(e) => updateLayer(selectedLayer.id, { fontSize: parseInt(e.target.value) })}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 block mb-1.5">Color</label>
                      <input
                        type="color"
                        value={selectedLayer.color}
                        onChange={(e) => updateLayer(selectedLayer.id, { color: e.target.value })}
                        className="w-full h-9 bg-slate-800 border border-slate-700 rounded-lg px-1 py-1 outline-none cursor-pointer"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-slate-500 block mb-1.5">Alignment</label>
                    <div className="flex bg-slate-800 border border-slate-700 rounded-lg p-1 gap-1">
                      {(['left', 'center', 'right'] as const).map((align) => (
                        <button
                          key={align}
                          onClick={() => updateLayer(selectedLayer.id, { textAlign: align })}
                          className={cn(
                            "flex-1 py-1.5 rounded-md flex items-center justify-center transition-all",
                            selectedLayer.textAlign === align 
                              ? "bg-blue-600 text-white shadow-lg shadow-blue-900/20" 
                              : "text-slate-400 hover:text-slate-200 hover:bg-slate-700"
                          )}
                        >
                          {align === 'left' && <AlignLeft size={16} />}
                          {align === 'center' && <AlignCenter size={16} />}
                          {align === 'right' && <AlignRight size={16} />}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-3 pt-2 border-t border-slate-800/50">
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-slate-500">Stroke Width</label>
                      <span className="text-[10px] text-slate-400">{selectedLayer.strokeWidth}px</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="20"
                      value={selectedLayer.strokeWidth}
                      onChange={(e) => updateLayer(selectedLayer.id, { strokeWidth: parseInt(e.target.value) })}
                      className="w-full"
                    />
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-slate-500">Stroke Color</label>
                      <input
                        type="color"
                        value={selectedLayer.strokeColor}
                        onChange={(e) => updateLayer(selectedLayer.id, { strokeColor: e.target.value })}
                        className="w-8 h-8 bg-slate-800 border border-slate-700 rounded-lg px-1 py-1 outline-none cursor-pointer"
                      />
                    </div>
                  </div>

                  <div className="space-y-3 pt-2 border-t border-slate-800/50">
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-slate-500">Shadow Blur</label>
                      <span className="text-[10px] text-slate-400">{selectedLayer.shadowBlur}px</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="50"
                      value={selectedLayer.shadowBlur}
                      onChange={(e) => updateLayer(selectedLayer.id, { shadowBlur: parseInt(e.target.value) })}
                      className="w-full"
                    />
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-slate-500">Shadow Color</label>
                      <input
                        type="color"
                        value={selectedLayer.shadowColor}
                        onChange={(e) => updateLayer(selectedLayer.id, { shadowColor: e.target.value })}
                        className="w-8 h-8 bg-slate-800 border border-slate-700 rounded-lg px-1 py-1 outline-none cursor-pointer"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>

        {/* Main Editor Area */}
        <main className="flex-1 bg-slate-950 p-8 flex flex-col items-center justify-center relative overflow-auto">
          {!image ? (
            <div
              {...getMainRootProps()}
              className={cn(
                "w-full max-w-2xl aspect-video border-2 border-dashed rounded-3xl flex flex-col items-center justify-center transition-all cursor-pointer",
                isMainDragActive ? "border-blue-500 bg-blue-500/5" : "border-slate-800 hover:border-slate-700 bg-slate-900/50"
              )}
            >
              <input {...getMainInputProps()} />
              <div className="w-16 h-16 bg-slate-800 rounded-2xl flex items-center justify-center mb-4">
                <Upload className="text-slate-400" />
              </div>
              <h2 className="text-xl font-semibold text-white mb-2">Upload your image</h2>
              <p className="text-slate-500 text-sm">Drag and drop or click to browse</p>
            </div>
          ) : (
            <div className="relative group" style={{ transform: `scale(${zoom})`, transition: 'transform 0.1s ease-out' }}>
              <div className="max-w-full rounded-xl overflow-visible shadow-2xl border border-slate-800 bg-slate-900">
                <canvas 
                  ref={canvasRef} 
                  className="max-w-full h-auto block cursor-default"
                  onMouseDown={handleCanvasMouseDown}
                  onMouseMove={handleCanvasMouseMove}
                  onMouseUp={handleCanvasMouseUp}
                  onMouseLeave={handleCanvasMouseUp}
                />
              </div>
              <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                <button
                  onClick={downloadImage}
                  className="bg-slate-800 hover:bg-slate-700 text-white p-3 rounded-xl shadow-lg flex items-center gap-2 font-medium"
                >
                  <Download size={20} />
                </button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

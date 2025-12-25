import { useEffect, useState, useRef } from "react";
import { FetchMessages, DownloadMedia, SendMessage, GetProfile, FetchContacts, GetContact } from "../../wailsjs/go/api/Api";
import { store, types } from "../../wailsjs/go/models";
import { EventsOn } from "../../wailsjs/runtime/runtime";

// WhatsApp-style markdown parser
function parseWhatsAppMarkdown(text: string): React.ReactNode[] {
    if (!text) return [text];

    const parts: React.ReactNode[] = [];
    let lastIndex = 0;

    // Regex patterns for WhatsApp formatting
    const patterns = [
        { regex: /\*([^*]+)\*/g, style: { fontWeight: 'bold' } }, // *bold*
        { regex: /_([^_]+)_/g, style: { fontStyle: 'italic' } }, // _italic_
        { regex: /~([^~]+)~/g, style: { textDecoration: 'line-through' } }, // ~strikethrough~
        { regex: /`([^`]+)`/g, style: { fontFamily: 'monospace', backgroundColor: 'rgba(0,0,0,0.1)', padding: '2px 4px', borderRadius: '3px' } }, // `code`
    ];

    // Find all matches and their positions
    const matches: Array<{ start: number, end: number, style: any, content: string }> = [];

    patterns.forEach(({ regex, style }) => {
        let match;
        while ((match = regex.exec(text)) !== null) {
            matches.push({
                start: match.index,
                end: match.index + match[0].length,
                style,
                content: match[1]
            });
        }
    });

    // Sort matches by start position
    matches.sort((a, b) => a.start - b.start);

    // Process matches and create React elements
    matches.forEach((match, index) => {
        // Add text before this match
        if (match.start > lastIndex) {
            parts.push(text.slice(lastIndex, match.start));
        }

        // Add the formatted text
        parts.push(
            <span key={index} style={match.style}>
                {match.content}
            </span>
        );

        lastIndex = match.end;
    });

    // Add remaining text
    if (lastIndex < text.length) {
        parts.push(text.slice(lastIndex));
    }

    return parts.length > 0 ? parts : [text];
}

interface ChatDetailProps {
    chatId: string;
    chatName: string;
    chatAvatar?: string;
    onBack?: () => void;
}

export function ChatDetail({ chatId, chatName, chatAvatar, onBack }: ChatDetailProps) {
    const [messages, setMessages] = useState<store.Message[]>([]);
    const [inputText, setInputText] = useState("");
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [pastedImage, setPastedImage] = useState<string | null>(null);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [selectedFileType, setSelectedFileType] = useState<string>("");
    const sentMediaCache = useRef<Map<string, string>>(new Map());

    const loadMessages = () => {
        FetchMessages(chatId).then((msgs) => {
            const unisex = Array.from(new Map((msgs || []).map(m => [m.Info.ID, m])).values());
            
            setMessages(unisex);
            setTimeout(scrollToBottom, 100);
        }).catch(console.error);
    };

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInputText(e.target.value);
        adjustTextareaHeight();
    };

    const adjustTextareaHeight = () => {
        const textarea = textareaRef.current;
        if (textarea) {
            textarea.style.height = 'auto';
            const scrollHeight = textarea.scrollHeight;
            const lineHeight = parseInt(getComputedStyle(textarea).lineHeight);
            const maxHeight = lineHeight * 8; // Maximum 8 lines
            textarea.style.height = Math.min(scrollHeight, maxHeight) + 'px';
        }
    };

    const handleSendMessage = async () => {
        if (!inputText.trim() && !pastedImage && !selectedFile) return;

        const textToSend = inputText;
        const imageToSend = pastedImage;
        const fileToSend = selectedFile;
        const fileTypeToSend = selectedFileType;
        setInputText("");
        setPastedImage(null);
        setSelectedFile(null);
        setSelectedFileType("");

        // Reset textarea height
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
        }
        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }

        // Optimistic update
        const tempMsg: any = {
            Info: {
                ID: `temp-${Date.now()}`,
                IsFromMe: true,
                Timestamp: new Date().toISOString(),
            },
            Content: imageToSend ? {
                imageMessage: {
                    caption: textToSend,
                    _tempImage: imageToSend
                }
            } : fileToSend ? {
                [`${fileTypeToSend}Message`]: {
                    caption: textToSend,
                    _tempFile: fileToSend
                }
            } : {
                conversation: textToSend
            }
        };

        setMessages(prev => [...prev, tempMsg]);
        setTimeout(scrollToBottom, 100);

        try {
            if (imageToSend) {
                const base64 = imageToSend.split(',')[1];
                const newId = await SendMessage(chatId, { type: "image", base64Data: base64, text: textToSend });
                if (newId) {
                    sentMediaCache.current.set(newId, imageToSend);
                }
            } else if (fileToSend) {
                const reader = new FileReader();
                reader.onload = async (event) => {
                    const base64 = (event.target?.result as string).split(',')[1];
                    const newId = await SendMessage(chatId, { type: fileTypeToSend, base64Data: base64, text: textToSend });
                    if (newId) {
                        sentMediaCache.current.set(newId, event.target?.result as string);
                    }
                };
                reader.readAsDataURL(fileToSend);
            } else {
                await SendMessage(chatId, { type: "text", text: textToSend });
            }
            loadMessages();
        } catch (err) {
            console.error("Failed to send message:", err);
            setMessages(prev => prev.filter(m => m.Info.ID !== tempMsg.Info.ID));
            setInputText(textToSend);
            setPastedImage(imageToSend);
            setSelectedFile(fileToSend);
            setSelectedFileType(fileTypeToSend);
            // Re-adjust height after setting text back
            setTimeout(adjustTextareaHeight, 0);
        }
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setSelectedFile(file);
            // Determine type based on mime type
            if (file.type.startsWith('image/')) {
                setSelectedFileType('image');
            } else if (file.type.startsWith('video/')) {
                setSelectedFileType('video');
            } else if (file.type.startsWith('audio/')) {
                setSelectedFileType('audio');
            } else {
                setSelectedFileType('document');
            }
        }
    };

    const removeSelectedFile = () => {
        setSelectedFile(null);
        setSelectedFileType("");
        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
        setTimeout(adjustTextareaHeight, 0);
    };

    const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const items = e.clipboardData?.items;
        if (!items) return;

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.type.indexOf('image') !== -1) {
                e.preventDefault();
                
                const file = item.getAsFile();
                if (file) {
                    const reader = new FileReader();
                    reader.onload = async (event) => {
                        const base64 = (event.target?.result as string);
                        setPastedImage(base64);
                        // Adjust height for the image preview
                        setTimeout(adjustTextareaHeight, 0);
                    };
                    reader.readAsDataURL(file);
                }
                break;
            }
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    useEffect(() => {
        loadMessages();
        
        const unsub = EventsOn("wa:new_message", () => {
             // Ideally we check if the message belongs to this chat
             loadMessages();
        });
        return () => {
            unsub();
        };
    }, [chatId]);

    return (
        <div className="flex flex-col h-full bg-[#efeae2] dark:bg-[#0b141a]">
            {/* Header */}
            <div className="flex items-center p-3 bg-[#f0f2f5] dark:bg-[#202c33] border-b border-gray-300 dark:border-gray-700">
                {onBack && (
                    <button onClick={onBack} className="mr-4 md:hidden">
                        <svg viewBox="0 0 24 24" width="24" height="24" className="fill-current text-gray-600 dark:text-gray-300">
                            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"></path>
                        </svg>
                    </button>
                )}
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center text-white font-bold overflow-hidden">
                        {chatAvatar ? (
                            <img src={chatAvatar} alt={chatName} className="w-full h-full object-cover" />
                        ) : (
                            chatName.substring(0, 1).toUpperCase()
                        )}
                    </div>
                    <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">{chatName}</h2>
                </div>
            </div>
            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-repeat" style={{ backgroundImage: "url('/assets/images/bg-chat-tile-dark.png')" }}>
                {messages.map((msg, idx) => (
                    <MessageItem key={msg.Info.ID || idx} message={msg} chatId={chatId} sentMediaCache={sentMediaCache} />
                ))}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area Skeleton */}
            <div className="p-3 bg-[#f0f2f5] dark:bg-[#202c33] flex items-end gap-2">
                <button className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200" title="Emoji">
                    <svg viewBox="0 0 24 24" width="24" height="24" className="fill-current">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z"/>
                    </svg>
                </button>
                <button className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200" title="Attach" onClick={() => fileInputRef.current?.click()}>
                    <svg viewBox="0 0 24 24" width="24" height="24" className="fill-current">
                        <path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5a2.5 2.5 0 0 0 5 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/>
                    </svg>
                </button>
                <div className="flex-1 bg-white dark:bg-[#2a3942] rounded-lg px-4 py-2 flex flex-col">
                    {pastedImage && (
                        <div className="mb-2 relative">
                            <img 
                                src={pastedImage} 
                                alt="Pasted image" 
                                className="max-w-full max-h-32 rounded-lg object-cover"
                            />
                            <button
                                onClick={removeSelectedFile}
                                className="absolute top-1 right-1 bg-black/50 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs hover:bg-black/70"
                                title="Remove file"
                            >
                                ×
                            </button>
                        </div>
                    )}
                    {selectedFile && (
                        <div className="mb-2 relative">
                            <div className="bg-gray-100 dark:bg-gray-700 p-2 rounded-lg flex items-center gap-2">
                                <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{selectedFile.name}</span>
                                <span className="text-xs text-gray-500 dark:text-gray-400">({selectedFileType})</span>
                            </div>
                            <button
                                onClick={removeSelectedFile}
                                className="absolute top-1 right-1 bg-black/50 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs hover:bg-black/70"
                                title="Remove file"
                            >
                                ×
                            </button>
                        </div>
                    )}
                    <textarea 
                        ref={textareaRef}
                        placeholder="Type a message" 
                        className="w-full bg-transparent outline-none text-gray-800 dark:text-gray-100 resize-none overflow-hidden"
                        value={inputText}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                        onPaste={handlePaste}
                        rows={1}
                        style={{ minHeight: '24px', maxHeight: '192px' }} // 1 line to 8 lines (24px * 8)
                    />
                </div>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt,.zip,.rar"
                    onChange={handleFileSelect}
                    className="hidden"
                />
                {inputText.trim() || pastedImage || selectedFile ? (
                    <button onClick={handleSendMessage} className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200" title="Send">
                        <svg viewBox="0 0 24 24" width="24" height="24" className="fill-current text-[#00a884] dark:text-[#00a884]">
                            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path>
                        </svg>
                    </button>
                ) : (
                    <button className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200" title="Voice Message">
                        <svg viewBox="0 0 24 24" width="24" height="24" className="fill-current">
                            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                            <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                        </svg>
                    </button>
                )}
            </div>
        </div>
    );
}

function MediaContent({ message, type, chatId, sentMediaCache }: { message: store.Message, type: 'image' | 'video' | 'sticker' | 'audio' | 'document', chatId: string, sentMediaCache?: React.MutableRefObject<Map<string, string>> }) {
    const [mediaSrc, setMediaSrc] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const getThumbnail = () => {
        let thumb: number[] | undefined;
        if (type === 'image') thumb = message.Content?.imageMessage?.JPEGThumbnail;
        else if (type === 'video') thumb = message.Content?.videoMessage?.JPEGThumbnail;
        else if (type === 'sticker') thumb = (message.Content?.stickerMessage as any)?.jpegThumbnail || (message.Content?.stickerMessage as any)?.pngThumbnail || (message.Content?.stickerMessage as any)?.PNGImage;
        
        if (thumb && thumb.length > 0) {
             const base64 = btoa(String.fromCharCode(...thumb));
             return `data:image/jpeg;base64,${base64}`;
        }
        return null;
    };

    const [thumbnail] = useState<string | null>(getThumbnail());

    const handleDownload = async () => {
        if (mediaSrc) return;
        setLoading(true);
        try {
            const data = await DownloadMedia(chatId, message.Info.ID);
            
            let mime = "application/octet-stream";
            if (type === 'image') mime = message.Content?.imageMessage?.mimetype || "image/jpeg";
            else if (type === 'video') mime = message.Content?.videoMessage?.mimetype || "video/mp4";
            else if (type === 'audio') mime = message.Content?.audioMessage?.mimetype || "audio/ogg";
            else if (type === 'sticker') mime = message.Content?.stickerMessage?.mimetype || "image/webp";
            else if (type === 'document') mime = message.Content?.documentMessage?.mimetype || "application/pdf";

            setMediaSrc(`data:${mime};base64,${data}`);
        } catch (e) {
            console.error(e);
            setError("Failed to download");
        } finally {
            setLoading(false);
        }
    };

    // Auto-download stickers so they appear immediately
    useEffect(() => {
        if (type === 'sticker') {
            // fire-and-forget
            handleDownload().catch(() => {});
        }
        
        // Check for temp media
        if (type === 'image') {
            if ((message.Content as any)?.imageMessage?._tempImage) {
                setMediaSrc((message.Content as any).imageMessage._tempImage);
            } else if (sentMediaCache && sentMediaCache.current.has(message.Info.ID)) {
                setMediaSrc(sentMediaCache.current.get(message.Info.ID)!);
            }
        } else if (type === 'video' || type === 'audio' || type === 'document') {
            if ((message.Content as any)?.[`${type}Message`]?.[`_tempFile`]) {
                setMediaSrc((message.Content as any)[`${type}Message`][`_tempFile`]);
            } else if (sentMediaCache && sentMediaCache.current.has(message.Info.ID)) {
                setMediaSrc(sentMediaCache.current.get(message.Info.ID)!);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (mediaSrc) {
        if (type === 'image') {
            return <img src={mediaSrc} alt="Media" className="max-w-full rounded-lg" />;
        } else if (type === 'sticker') {
            // Stickers should be displayed as 195x195, preserving transparency and without additional bg
            return <img src={mediaSrc} alt="Sticker" className="object-contain" style={{ width: 195, height: 195, borderRadius: 12 }} />;
        } else if (type === 'video') {
            return <video src={mediaSrc} controls className="max-w-full rounded-lg" />;
        } else if (type === 'audio') {
            return <audio src={mediaSrc} controls className="w-full" />;
        }
    }

    return (
        <div className="relative">
            {thumbnail && (
                type === 'sticker' ? (
                    <img src={thumbnail} alt="Sticker thumbnail" className={`object-contain ${loading ? 'opacity-50' : ''}`} style={{ width: 195, height: 195, borderRadius: 12 }} />
                ) : (
                    <img src={thumbnail} alt="Thumbnail" className={`max-w-full rounded-lg ${loading ? 'opacity-50' : ''}`} />
                )
            )}
            {!thumbnail && (
                <div className={type === 'sticker' ? "bg-transparent flex items-center justify-center" : "w-64 h-64 bg-gray-200 dark:bg-gray-700 flex items-center justify-center rounded-lg"} style={type === 'sticker' ? { width: 195, height: 195, borderRadius: 12 } : undefined}>
                    <span className="text-gray-500 dark:text-gray-400">{type.toUpperCase()}</span>
                </div>
            )}
            <div className="absolute inset-0 flex items-center justify-center bg-black/20 rounded-lg">
                {loading ? (
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
                ) : !mediaSrc ? (
                    <button onClick={handleDownload} className="bg-black/50 hover:bg-black/70 text-white rounded-full p-3 transition-colors">
                        <svg viewBox="0 0 24 24" width="20" height="20" className="fill-current">
                            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                        </svg>
                    </button>
                ) : null}
            </div>
            {error && <div className="text-red-500 text-xs mt-1">{error}</div>}
        </div>
    );
}

function QuotedMessage({ contextInfo }: { contextInfo: any }) {
    const [name, setName] = useState<string>("");

    useEffect(() => {
        const participant = contextInfo.participant || contextInfo.Participant;
        if (participant) {
            GetProfile(participant).then((contact: any) => {
                setName(contact.full_name || contact.push_name || contact.jid);
            })
        }
    }, [contextInfo]);

    const quoted = contextInfo.quotedMessage || contextInfo.QuotedMessage;
    if (!quoted) return null;

    let text: React.ReactNode = "Unsupported message";
    if (quoted.conversation) text = parseWhatsAppMarkdown(quoted.conversation);
    else if (quoted.extendedTextMessage?.text) text = parseWhatsAppMarkdown(quoted.extendedTextMessage.text);
    else if (quoted.imageMessage) text = "📷 Photo";
    else if (quoted.videoMessage) text = "🎥 Video";
    else if (quoted.audioMessage) text = "🎵 Audio";
    else if (quoted.documentMessage) text = "📄 Document";
    else if (quoted.stickerMessage) text = "💟 Sticker";

    return (
        <div className="bg-black/5 dark:bg-white/10 rounded-md p-2 mb-2 border-l-4 border-[#00a884] dark:border-[#00a884] text-sm cursor-pointer">
            <div className="font-bold text-[#00a884] dark:text-[#00a884] text-xs mb-1">{name}</div>
            <div className="line-clamp-2 text-gray-600 dark:text-gray-300 text-xs">{text}</div>
        </div>
    );
}

function MessageItem({ message, chatId, sentMediaCache }: { message: store.Message, chatId: string, sentMediaCache?: React.MutableRefObject<Map<string, string>> }) {
    const isMe = message.Info.IsFromMe;
    const isTemp = message.Info.ID.startsWith("temp-");
    const isSticker = !!message.Content?.stickerMessage;
    const isImageOrVideo = !!(message.Content?.imageMessage || message.Content?.videoMessage);
    const timeStr = new Date(message.Info.Timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    var senderName = message.Info.PushName;
    if (!message.Info.Sender.toString().endsWith("lid")) {
        GetContact(message.Info.Sender).then((contact: any) => {
            senderName = contact.full_name || senderName || contact.jid;
        }).catch(() => {
            senderName = senderName || message.Info.Sender.toString();
        });
    }

    // Check for quoted message
    const contextInfo = message.Content?.extendedTextMessage?.contextInfo ||
                        message.Content?.imageMessage?.contextInfo ||
                        message.Content?.videoMessage?.contextInfo ||
                        message.Content?.audioMessage?.contextInfo ||
                        message.Content?.stickerMessage?.contextInfo ||
                        message.Content?.documentMessage?.contextInfo ||
                        message.Content?.contactMessage?.contextInfo ||
                        message.Content?.locationMessage?.contextInfo;

    const hasQuote = contextInfo && (contextInfo.quotedMessage);

    // Determine content
    let content: React.ReactNode = "";

    if (message.Content?.conversation) {
        content = parseWhatsAppMarkdown(message.Content.conversation);
    } else if (message.Content?.extendedTextMessage?.text) {
        content = parseWhatsAppMarkdown(message.Content.extendedTextMessage.text);
    } else if (message.Content?.imageMessage) {
        content = (
            <div>
                <MediaContent message={message} type="image" chatId={chatId} sentMediaCache={sentMediaCache} />
                {message.Content.imageMessage.caption && <div className="mt-1">{parseWhatsAppMarkdown(message.Content.imageMessage.caption)}</div>}
            </div>
        );
    } else if (message.Content?.stickerMessage) {
        content = <MediaContent message={message} type="sticker" chatId={chatId} sentMediaCache={sentMediaCache} />;
    } else if (message.Content?.videoMessage) {
        content = (
            <div>
                <MediaContent message={message} type="video" chatId={chatId} sentMediaCache={sentMediaCache} />
                {message.Content.videoMessage.caption && <div className="mt-1">{parseWhatsAppMarkdown(message.Content.videoMessage.caption)}</div>}
            </div>
        );
    } else if (message.Content?.audioMessage) {
        content = <MediaContent message={message} type="audio" chatId={chatId} sentMediaCache={sentMediaCache} />;
    } else if (message.Content?.viewOnceMessage?.message?.imageMessage) {
        content = "📷 Photo (View Once)";
    } else if (message.Content?.viewOnceMessage?.message?.videoMessage) {
        content = "🎥 Video (View Once)";
    } else if (message.Content?.viewOnceMessageV2?.message?.imageMessage) {
        content = "📷 Photo (View Once V2)";
    } else if (message.Content?.viewOnceMessageV2?.message?.videoMessage) {
        content = "🎥 Video (View Once V2)";
    } else if (message.Content?.documentMessage) {
        const doc = message.Content.documentMessage;
        const fileName = doc.fileName || "Document";
        const fileLength = typeof doc.fileLength === 'number' ? doc.fileLength : (doc.fileLength as any)?.low || 0;
        const extension = fileName.split('.').pop()?.toUpperCase() || "FILE";
        
        const formatSize = (bytes: number) => {
            if (!bytes) return "0 B";
            const k = 1024;
            const sizes = ["B", "KB", "MB", "GB"];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
        };

        content = (
            <div>
                <div className="flex items-center gap-3 bg-black/5 dark:bg-white/5 p-2 rounded-lg min-w-[240px]">
                    <div className="w-10 h-12 bg-red-500 rounded-lg flex items-center justify-center text-white font-bold text-xs relative">
                         <div className="absolute top-0 right-0 border-t-[12px] border-r-[12px] border-t-white/20 border-r-transparent"></div>
                         {extension.slice(0, 4)}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="truncate font-medium text-sm">{fileName}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                            {extension} • {formatSize(fileLength)}
                        </div>
                    </div>
                    <button 
                        onClick={(e) => {
                            e.stopPropagation();
                            console.log("Attempting document download:", { chatId, messageId: message.Info.ID });
                            DownloadMedia(chatId, message.Info.ID).catch((err) => console.error("Document download failed:", err));
                        }}
                        className="w-10 h-10 flex items-center justify-center border border-gray-300 dark:border-gray-600 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                    >
                        <svg viewBox="0 0 24 24" width="20" height="20" className="fill-current text-gray-500 dark:text-gray-400">
                            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                        </svg>
                    </button>
                </div>
                {doc.caption && <div className="mt-1">{parseWhatsAppMarkdown(doc.caption)}</div>}
            </div>
        );
    } else if (message.Content?.contactMessage) {
        content = "👤 Contact: " + (message.Content.contactMessage.displayName || "Unknown");
    } else if (message.Content?.locationMessage) {
        content = "📍 Location";
    } else if (message.Content?.protocolMessage) {
        content = "Protocol Message (e.g. Revoke/History Sync)";
    } else if (message.Content?.reactionMessage) {
        content = "Reaction: " + message.Content.reactionMessage.text;
    } else if (message.Content?.pollCreationMessage || message.Content?.pollCreationMessageV2 || message.Content?.pollCreationMessageV3) {
        content = "📊 Poll";
    } else {
        // Fallback: find the first key that is not null/undefined
        const keys = Object.keys(message.Content || {}).filter(k => message.Content && (message.Content as any)[k]);
        if (keys.length > 0) {
            content = `Unsupported: ${keys.join(", ")}`;
        } else {
            content = "Unsupported message type (Empty Content)";
        }
    }

    if (isSticker && !hasQuote) {
        return (
            <div className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                <div className={`${isMe ? 'ml-2' : 'mr-2'} flex flex-col items-start`}>
                    <div>
                        {content}
                    </div>
                    <div className={`w-full flex ${isMe ? 'justify-end' : 'justify-start'} mt-2`}>
                        <div className="bg-white dark:bg-[#0b141a] rounded-full px-3 py-1 flex items-center gap-2 text-[11px] text-gray-600 dark:text-gray-300">
                            <span>{timeStr}</span>
                            {isMe && (
                                <span className={`${isTemp ? 'text-gray-500' : 'bg-blue-500 text-white'} rounded-full flex items-center justify-center`} style={{ width: 18, height: 18 }}>
                                    {isTemp ? (
                                        <svg viewBox="0 0 24 24" width="12" height="12" className="fill-current">
                                            <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/>
                                        </svg>
                                    ) : (
                                        <svg viewBox="0 0 16 15" width="12" height="12" className="fill-current">
                                            <path d="M15.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L8.666 9.879a.32.32 0 0 1-.484.033l-.358-.325a.319.319 0 0 0-.484.032l-.378.483a.418.418 0 0 0 .036.541l1.32 1.266c.143.14.361.125.484-.033l6.272-7.674a.366.366 0 0 0-.064-.512zm-4.1 0l-.478-.372a.365.365 0 0 0-.51.063L4.566 9.879a.32.32 0 0 1-.484.033L1.891 7.769a.366.366 0 0 0-.515.006l-.423.433a.364.364 0 0 0 .006.514l3.258 3.185c.143.14.361.125.484-.033l6.272-7.674a.365.365 0 0 0-.063-.51z"/>
                                                </svg>
                                    )}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
            <div className={`${isImageOrVideo ? 'max-w-[65%]' : 'max-w-[70%]'} rounded-lg p-2 px-3 shadow-sm relative group ${
                isMe 
                ? 'bg-[#d9fdd3] dark:bg-[#005c4b] text-gray-900 dark:text-gray-100 rounded-tr-none' 
                : 'bg-white dark:bg-[#202c33] text-gray-900 dark:text-gray-100 rounded-tl-none'
            }`}>
                {!isMe && (
                    <div className="text-[11px] font-semibold text-[#53bdeb] dark:text-[#53bdeb] mb-0.5">
                        {senderName}
                    </div>
                )}
                
                {hasQuote && <QuotedMessage contextInfo={contextInfo} />}

                <div className="text-sm whitespace-pre-wrap break-words">
                    {content}
                </div>
                <div className="flex justify-end items-center gap-1 mt-1">
                    <span className="text-[10px] text-gray-500 dark:text-gray-400">
                        {timeStr}
                    </span>
                    {isMe && (
                        <span className={isTemp ? "text-gray-500" : "text-blue-500"}>
                            {isTemp ? (
                                <svg viewBox="0 0 24 24" width="16" height="16" className="fill-current">
                                    <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/>
                                </svg>
                            ) : (
                                /* Double tick icon */
                                <svg viewBox="0 0 16 15" width="16" height="15" className="fill-current">
                                    <path d="M15.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L8.666 9.879a.32.32 0 0 1-.484.033l-.358-.325a.319.319 0 0 0-.484.032l-.378.483a.418.418 0 0 0 .036.541l1.32 1.266c.143.14.361.125.484-.033l6.272-7.674a.366.366 0 0 0-.064-.512zm-4.1 0l-.478-.372a.365.365 0 0 0-.51.063L4.566 9.879a.32.32 0 0 1-.484.033L1.891 7.769a.366.366 0 0 0-.515.006l-.423.433a.364.364 0 0 0 .006.514l3.258 3.185c.143.14.361.125.484-.033l6.272-7.674a.365.365 0 0 0-.063-.51z"/>
                                </svg>
                            )}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}

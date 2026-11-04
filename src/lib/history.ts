import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  type Firestore,
} from "firebase/firestore";

export type HistoryMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};

export type LoadedConversation = {
  id: string;
  messages: HistoryMessage[];
};

export async function loadLatestConversation(db: Firestore, uid: string): Promise<LoadedConversation | null> {
  const conversations = await getDocs(
    query(collection(db, "users", uid, "conversations"), orderBy("updatedAt", "desc"), limit(1)),
  );
  if (conversations.empty) return null;

  const conversation = conversations.docs[0];
  const messagesSnap = await getDocs(
    query(collection(db, "users", uid, "conversations", conversation.id, "messages"), orderBy("createdAt", "asc")),
  );

  const messages = messagesSnap.docs.flatMap((entry) => {
    const data = entry.data();
    if ((data.role !== "user" && data.role !== "assistant") || typeof data.content !== "string") {
      return [];
    }
    return [
      {
        id: entry.id,
        role: data.role,
        content: data.content,
        createdAt: typeof data.createdAt === "number" ? data.createdAt : Date.now(),
      },
    ];
  });

  return { id: conversation.id, messages };
}

export async function createConversation(db: Firestore, uid: string): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();
  await setDoc(doc(db, "users", uid, "conversations", id), {
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function saveMessage(
  db: Firestore,
  uid: string,
  conversationId: string,
  role: "user" | "assistant",
  content: string,
): Promise<void> {
  const createdAt = Date.now();
  await addDoc(collection(db, "users", uid, "conversations", conversationId, "messages"), {
    role,
    content,
    createdAt,
  });
  await setDoc(
    doc(db, "users", uid, "conversations", conversationId),
    { updatedAt: createdAt },
    { merge: true },
  );
}

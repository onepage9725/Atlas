import { useEffect, useMemo, useRef, useState } from "react";
import { Save, Upload, Pencil, Trash2 } from "lucide-react";
import { fetchNotificationProfiles, notifyEventCreated } from "../lib/notifications";
import { supabase } from "../lib/supabaseClient";

type EventRecord = {
  id: string;
  event_name: string;
  start_date: string | null;
  end_date: string | null;
  description: string | null;
  image_url: string | null;
  created_at: string;
};

const emptyForm = {
  eventName: "",
  startDate: "",
  endDate: "",
  description: "",
  imageName: "",
  imageUrl: "",
};

export function EventsForm({ userId }: { userId: string }) {
  const [formData, setFormData] = useState(emptyForm);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const eventCount = useMemo(() => events.length, [events]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];

    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }

    setImageFile(file ?? null);
    setFormData((prev) => {
      if (!file) {
        return { ...prev, imageName: prev.imageUrl ? prev.imageName : "" };
      }

      const previewUrl = URL.createObjectURL(file);
      previewUrlRef.current = previewUrl;

      return {
        ...prev,
        imageName: file.name,
        imageUrl: previewUrl,
      };
    });
  };

  const resetForm = () => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setFormData(emptyForm);
    setEditingId(null);
    setImageFile(null);
    if (imageInputRef.current) {
      imageInputRef.current.value = "";
    }
  };

  const mapRecordToForm = (event: EventRecord) => {
    setFormData({
      eventName: event.event_name ?? "",
      startDate: event.start_date ?? "",
      endDate: event.end_date ?? "",
      description: event.description ?? "",
      imageName: event.image_url ? event.image_url.split("/").pop() ?? "" : "",
      imageUrl: event.image_url ?? "",
    });
  };

  const getStoragePathFromUrl = (url: string, bucket: string) => {
    const marker = `/storage/v1/object/public/${bucket}/`;
    const index = url.indexOf(marker);
    if (index === -1) return null;
    return url.slice(index + marker.length);
  };

  const deleteEventImageFromStorage = async (url: string | null) => {
    if (!url) return;
    const path = getStoragePathFromUrl(url, "events");
    if (!path) return;
    await supabase.storage.from("events").remove([path]);
  };

  const fetchEvents = async () => {
    setError(null);
    const { data, error: fetchError } = await supabase
      .from("events")
      .select("*")
      .order("created_at", { ascending: false });

    if (fetchError) {
      setError(fetchError.message);
      return;
    }

    setEvents((data as EventRecord[]) ?? []);
  };

  useEffect(() => {
    fetchEvents();
  }, []);

  const uploadImage = async (): Promise<{ newUrl: string | null; oldUrl: string | null }> => {
    if (!imageFile) return { newUrl: formData.imageUrl || null, oldUrl: null };

    const filePath = `${Date.now()}-${imageFile.name}`;
    const { error: uploadError } = await supabase.storage
      .from("events")
      .upload(filePath, imageFile, { upsert: true });

    if (uploadError) {
      throw uploadError;
    }

    const { data } = supabase.storage.from("events").getPublicUrl(filePath);
    return { newUrl: data.publicUrl, oldUrl: formData.imageUrl || null };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const { newUrl, oldUrl } = await uploadImage();
      const isCreating = !editingId;
      const payload = {
        event_name: formData.eventName,
        start_date: formData.startDate || null,
        end_date: formData.endDate || null,
        description: formData.description,
        image_url: newUrl,
      };

      const { error: submitError } = editingId
        ? await supabase.from("events").update(payload).eq("id", editingId)
        : await supabase.from("events").insert([payload]);

      if (submitError) {
        setError(submitError.message);
        setIsSubmitting(false);
        return;
      }

      if (isCreating) {
        try {
          const notificationProfiles = await fetchNotificationProfiles();
          await notifyEventCreated({
            actorUserId: userId,
            eventName: formData.eventName,
            startDate: formData.startDate || null,
            profiles: notificationProfiles,
          });
        } catch (notificationError) {
          console.error("Failed to create event notifications", notificationError);
        }
      }

      await fetchEvents();
      resetForm();
      if (newUrl && oldUrl && newUrl !== oldUrl) {
        await deleteEventImageFromStorage(oldUrl);
      }
      setIsSubmitting(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed.";
      setError(message);
      setIsSubmitting(false);
    }
  };

  const handleEdit = (event: EventRecord) => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setEditingId(event.id);
    setImageFile(null);
    mapRecordToForm(event);
    if (imageInputRef.current) {
      imageInputRef.current.value = "";
    }
  };

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    };
  }, []);

  const handleDelete = async (eventId: string) => {
    setError(null);
    const eventToDelete = events.find((eventItem) => eventItem.id === eventId);
    if (eventToDelete?.image_url) {
      await deleteEventImageFromStorage(eventToDelete.image_url);
    }
    const { error: deleteError } = await supabase.from("events").delete().eq("id", eventId);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    await fetchEvents();
    if (editingId === eventId) {
      resetForm();
    }
  };

  return (
    <div className="px-4 pb-8 pt-20 md:ml-[220px] md:w-[calc(100%-220px)] md:px-8 md:pb-12 md:pt-24">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">
            {editingId ? "Edit Event" : "Create Event"}
          </h2>
          <p className="text-gray-500 text-sm mt-1">
            Add event details, dates, and image attachments
          </p>
          <p className="text-xs text-gray-400 mt-1">{eventCount} events saved</p>
        </div>
        <button
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition"
        >
          <Save className="w-4 h-4" />
          {isSubmitting ? "Saving..." : "Save Event"}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-800 border-b border-gray-100 pb-3 mb-4">
            Event Details
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Event Name
              </label>
              <input
                type="text"
                name="eventName"
                value={formData.eventName}
                onChange={handleChange}
                placeholder="e.g. New Launch Preview"
                className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Start Date
              </label>
              <input
                type="date"
                name="startDate"
                value={formData.startDate}
                onChange={handleChange}
                className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                End Date
              </label>
              <input
                type="date"
                name="endDate"
                value={formData.endDate}
                onChange={handleChange}
                className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
              />
              <p className="text-xs text-gray-400 mt-1">Optional for single-day events.</p>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <textarea
                name="description"
                value={formData.description}
                onChange={handleChange}
                placeholder="Add event description"
                rows={4}
                className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none resize-none"
              />
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-800 border-b border-gray-100 pb-3 mb-4">
            Attach Image
          </h3>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg text-sm cursor-pointer hover:bg-gray-50">
              <Upload className="w-4 h-4 text-gray-500" />
              Upload Image
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                className="hidden"
              />
            </label>
            <span className="text-sm text-gray-500">{formData.imageName || "No file selected"}</span>
          </div>
          {formData.imageUrl && (
            <div className="mt-4 space-y-3">
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                className="block w-full overflow-hidden rounded-lg border border-gray-100 bg-gray-50 text-left hover:border-primary"
              >
                <img
                  src={formData.imageUrl}
                  alt="Event"
                  className="max-h-[320px] w-full object-contain"
                />
              </button>
              <div className="flex items-center justify-between gap-4 text-xs text-gray-500">
                <span>Click the image to replace it.</span>
                <a
                  href={formData.imageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-primary hover:underline"
                >
                  View full image
                </a>
              </div>
            </div>
          )}
        </div>
      </form>

      <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm mt-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-800">Saved Events</h3>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="text-sm text-gray-500 hover:text-gray-800"
            >
              Cancel edit
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-100">
                <th className="py-2">Event</th>
                <th className="py-2">Dates</th>
                <th className="py-2">Image</th>
                <th className="py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-b border-gray-50">
                  <td className="py-3">
                    <div className="font-medium text-gray-900">{event.event_name}</div>
                    <div className="text-xs text-gray-500">
                      {event.description || "No description"}
                    </div>
                  </td>
                  <td className="py-3 text-gray-600">
                    {event.start_date || "-"} - {event.end_date || "-"}
                  </td>
                  <td className="py-3">
                    {event.image_url ? (
                      <img
                        src={event.image_url}
                        alt={event.event_name}
                        className="h-10 w-14 rounded-md object-cover border border-gray-100"
                      />
                    ) : (
                      <span className="text-xs text-gray-400">No image</span>
                    )}
                  </td>
                  <td className="py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => handleEdit(event)}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-gray-200 text-gray-600 hover:text-gray-900"
                      >
                        <Pencil className="h-3 w-3" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(event.id)}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-red-200 text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="h-3 w-3" />
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {events.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-gray-500">
                    No events yet. Add your first event above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

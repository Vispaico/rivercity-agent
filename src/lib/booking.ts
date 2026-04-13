import { supabase } from "./supabase.js";

type VehicleRow = {
  id: string;
  name?: string | null;
  category?: string | null;
  price_per_hour?: number | null;
  price_per_day?: number | null;
  price_per_week?: number | null;
  price_per_month?: number | null;
  currency?: string | null;
};

type BookingIntake = {
  full_name?: string;
  phone?: string;
  email?: string;
  address?: string;
  passport_number?: string;
  contact_channels?: string[];
  notes?: string;
  day_count?: number;
  pricing_summary?: unknown;
};

type BookingSession = {
  active: boolean;
  startDate?: string;
  endDate?: string;
  quantity?: number;
  availableVehicles?: { vehicle: VehicleRow; available: number }[];
  selectedVehicleId?: string;
  intake?: BookingIntake;
  lastPrompt?: "ask_dates" | "no_availability" | "clarify_vehicle" | "ask_intake";
};

type StoredSession = {
  session_id: string;
  data: BookingSession;
  updated_at?: string;
};

export async function handleBookingRequest(
  message: string,
  userLanguage: string,
  sessionId: string
): Promise<string | null> {
  await cleanupExpiredSessions();
  const session = await getSession(sessionId);
  const intent = isBookingIntent(message);
  const availabilityInquiry = isAvailabilityInquiry(message);
  const goodbye = isGoodbyeIntent(message);

  if (!intent && !session.active) return null;

  if (isCancelIntent(message)) {
    await clearSession(sessionId);
    return bookingCopy(userLanguage).cancelled;
  }

  if (goodbye) {
    await clearSession(sessionId);
    return bookingCopy(userLanguage).goodbye;
  }

  session.active = true;
  await upsertSession(sessionId, session);

  if (session.lastPrompt === "no_availability" && isNegativeResponse(message)) {
    session.lastPrompt = "ask_dates";
    await upsertSession(sessionId, session);
    return bookingCopy(userLanguage).askDates;
  }

  const dates = extractDates(message) ?? {
    startDate: session.startDate,
    endDate: session.endDate,
  };
  if (!dates?.startDate || !dates?.endDate) {
    session.active = true;
    session.lastPrompt = "ask_dates";
    if (availabilityInquiry) {
      const availableVehicles = await getAvailableVehicles();
      session.availableVehicles = availableVehicles.length
        ? availableVehicles
        : session.availableVehicles;
      await upsertSession(sessionId, session);
      return formatAvailabilityList(
        userLanguage,
        session.availableVehicles ?? []
      );
    }

    await upsertSession(sessionId, session);
    return bookingCopy(userLanguage).askDates;
  }

  const { startDate, endDate } = dates;
  session.startDate = startDate;
  session.endDate = endDate;

  const vehiclePreference = extractVehiclePreference(message);
  const quantity = extractQuantity(message) ?? session.quantity ?? 1;
  session.quantity = quantity;

  if (!session.availableVehicles) {
    const availableVehicles = await getAvailableVehicles();
    if (!availableVehicles.length) {
      session.lastPrompt = "no_availability";
      await upsertSession(sessionId, session);
      return bookingCopy(userLanguage).noAvailability;
    }

    session.availableVehicles = availableVehicles;
    await upsertSession(sessionId, session);
  }

  const selected = await resolveVehicleSelection(
    message,
    vehiclePreference,
    session.availableVehicles.map((item) => item.vehicle)
  );

  if (selected.length === 0) {
    session.lastPrompt = "clarify_vehicle";
    await upsertSession(sessionId, session);
    return formatAvailabilityList(userLanguage, session.availableVehicles);
  }

  if (selected.length > 1) {
    session.lastPrompt = "clarify_vehicle";
    await upsertSession(sessionId, session);
    return bookingCopy(userLanguage).clarifyVehicle(
      selected.map((vehicle) => formatVehicle(vehicle)).join("\n")
    );
  }

  session.selectedVehicleId = selected[0].id;
  const intake = mergeIntake(session.intake, extractIntake(message));
  const name = extractName(message);
  if (name) intake.full_name = name;
  session.intake = intake;

  const missing = missingIntakeFields(intake);
  if (missing.length) {
    session.lastPrompt = "ask_intake";
    await upsertSession(sessionId, session);
    return bookingCopy(userLanguage).askIntake(missing.join(", "));
  }

  const dayCount = Math.max(
    1,
    Math.ceil(
      (new Date(endDate).getTime() - new Date(startDate).getTime()) /
        (1000 * 60 * 60 * 24)
    )
  );

  intake.day_count = dayCount;

  if (!session.selectedVehicleId) {
    session.lastPrompt = "clarify_vehicle";
    await upsertSession(sessionId, session);
    return bookingCopy(userLanguage).clarifyVehicle(
      session.availableVehicles
        .map((item) => formatVehicle(item.vehicle))
        .join("\n")
    );
  }

  const booking = await createBooking(
    startDate,
    endDate,
    session.selectedVehicleId,
    quantity,
    intake
  );

  if (!booking) {
    await upsertSession(sessionId, session);
    return bookingCopy(userLanguage).bookingFailed;
  }

  await clearSession(sessionId);
  return bookingCopy(userLanguage).bookingCreated(String(booking));
}

function isBookingIntent(message: string) {
  const lower = message.toLowerCase();
  return /\b(book|booking|reserve|reservation|rent|rental|hire|alquilar|reserva|reservar|thuê|đặt|bookar)\b/.test(
    lower
  );
}

function isCancelIntent(message: string) {
  return /\b(cancel|stop|reset|start over|clear)\b/i.test(message);
}

function isGoodbyeIntent(message: string) {
  return /\b(thank you|thanks|goodbye|bye|see you|ok thanks|ok thank you|gracias|adios|chau|cảm ơn|tạm biệt)\b/i.test(
    message
  );
}

function isNegativeResponse(message: string) {
  return /\b(no|nope|nah|không|ko|not really|no thanks)\b/i.test(message);
}

function isAvailabilityInquiry(message: string) {
  return /\b(available|availability|what dates|when|which dates|vehicles available|what vehicles|what do you have)\b/i.test(
    message
  );
}

function extractDates(message: string) {
  const isoMatches = message.match(/\d{4}-\d{2}-\d{2}/g);
  if (isoMatches && isoMatches.length >= 2) {
    return { startDate: isoMatches[0], endDate: isoMatches[1] };
  }

  const dotMatches = message.match(/\d{2}\.\d{2}\.\d{4}/g);
  if (dotMatches && dotMatches.length >= 2) {
    const normalized = dotMatches.map((value) => {
      const [day, month, year] = value.split(".");
      return `${year}-${month}-${day}`;
    });
    return { startDate: normalized[0], endDate: normalized[1] };
  }

  return null;
}

function extractVehiclePreference(message: string) {
  const lower = message.toLowerCase();
  if (/\bcar|auto|sedan|suv|van|coche|auto\b/.test(lower)) return "car";
  if (/\bmanual\b/.test(lower)) return "manual";
  if (/\bautomatic|scooter|motorbike|bike|xe máy|xe may\b/.test(lower))
    return "motorbike";
  return null;
}

function extractQuantity(message: string) {
  const match = message.match(/(\d+)\s*(motorbikes|bikes|cars|xe|vehicles)/i);
  return match ? Number(match[1]) : null;
}

function extractIntake(message: string): BookingIntake {
  const emailMatch = message.match(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
  );
  const phoneMatch = message.match(/(\+?\d[\d\s-]{6,})/);

  return {
    email: emailMatch ? emailMatch[0] : undefined,
    phone: phoneMatch ? phoneMatch[0].replace(/\s+/g, "") : undefined,
  };
}

function mergeIntake(existing?: BookingIntake, next?: BookingIntake) {
  return {
    ...existing,
    ...next,
  };
}

function extractName(message: string) {
  const match =
    message.match(
      /\b(name is|i am|i'm|my name is|soy|me llamo|tôi là)\s+([A-Za-zÀ-ÿ'\- ]{2,})/i
    ) || message.match(/\bname:\s*([A-Za-zÀ-ÿ'\- ]{2,})/i);
  if (!match) return undefined;
  return match[2]?.trim() || match[1]?.trim();
}

function missingIntakeFields(intake: BookingIntake) {
  const missing: string[] = [];
  if (!intake.full_name) missing.push("full name");
  if (!intake.phone && !intake.email) missing.push("phone or email");
  return missing;
}

export async function getAvailableVehicles() {
  const { data, error } = await supabase
    .from("vehicles")
    .select(
      "id,name,brand,model,type,price_per_hour,price_per_day,price_per_week,price_per_month,currency,inventory_count,active"
    )
    .eq("active", true)
    .gt("inventory_count", 0);

  if (error) {
    console.error("[booking] vehicles fetch error:", error);
    return [];
  }

  const vehicles = (data as (VehicleRow & { inventory_count?: number })[]) || [];
  return vehicles.map((vehicle) => ({
    vehicle,
    available: Number(vehicle.inventory_count ?? 1),
  }));
}

async function resolveVehicleSelection(
  message: string,
  preference: string | null,
  vehicles: VehicleRow[]
) {
  const lower = message.toLowerCase();
  const matches = vehicles.filter((vehicle) => {
    const name = [vehicle.name, vehicle.name, vehicle.category]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (name && lower.includes(name)) return true;
    if (preference === "car" && vehicle.category?.toLowerCase().includes("car"))
      return true;
    if (
      preference === "motorbike" &&
      vehicle.category?.toLowerCase().includes("bike")
    )
      return true;
    if (preference === "manual" && lower.includes("manual")) return true;
    return false;
  });

  return matches;
}

async function createBooking(
  startDate: string,
  endDate: string,
  vehicleId: string,
  quantity: number,
  intake: BookingIntake
) {
  const { data, error } = await supabase.rpc("create_booking", {
    p_start_date: startDate,
    p_end_date: endDate,
    p_items: [{ vehicle_id: vehicleId, quantity }],
    p_intake: intake,
  });

  if (error) {
    console.error("[booking] create_booking error:", error);
    return null;
  }

  return data;
}

export function formatAvailabilityList(
  language: string,
  available: { vehicle: VehicleRow; available: number }[]
) {
  const header =
    language === "Spanish"
      ? "Disponibilidad:"
      : language === "Vietnamese"
      ? "Tình trạng xe trống:"
      : "Availability:";

  const items = available
    .map((item) => `- ${formatVehicle(item.vehicle)} (x${item.available})`)
    .join("\n");

  return `${header}\n${items}`;
}

export function formatVehicle(vehicle: VehicleRow) {
  const name = [vehicle.name, vehicle.name, vehicle.category]
    .filter(Boolean)
    .join(" ")
    .trim();
  const price =
    vehicle.price_per_day != null
      ? ` (${vehicle.price_per_day}/${vehicle.currency ?? "day"})`
      : "";
  return `${name || vehicle.id}${price}`;
}

async function getSession(sessionId: string): Promise<BookingSession> {
  const { data, error } = await supabase
    .from("agent_sessions")
    .select("session_id, data, updated_at")
    .eq("session_id", sessionId)
    .maybeSingle();

  if (error) {
    console.error("[booking] session fetch error:", error);
    return { active: false };
  }

  if (!data) return { active: false };
  return (data as StoredSession).data ?? { active: false };
}

async function clearSession(sessionId: string) {
  const { error } = await supabase
    .from("agent_sessions")
    .delete()
    .eq("session_id", sessionId);

  if (error) {
    console.error("[booking] session delete error:", error);
  }
}

async function upsertSession(sessionId: string, data: BookingSession) {
  const { error } = await supabase.from("agent_sessions").upsert({
    session_id: sessionId,
    data,
  });

  if (error) {
    console.error("[booking] session upsert error:", error);
  }
}

async function cleanupExpiredSessions() {
  const { error } = await supabase
    .from("agent_sessions")
    .delete()
    .lt("updated_at", new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString());

  if (error) {
    console.error("[booking] session cleanup error:", error);
  }
}

function bookingCopy(language: string) {
  if (language === "Spanish") {
    return {
      askDates:
        "¿Para qué fechas quieres reservar? Usa el formato AAAA-MM-DD a AAAA-MM-DD.",
      askIntake: (fields: string) =>
        `Para crear la reserva necesito: ${fields}.`,
      clarifyVehicle: (options: string) =>
        `¿Cuál vehículo quieres reservar?\n${options}`,
      noAvailability:
        "No veo disponibilidad para esas fechas. ¿Quieres probar otras fechas?",
      bookingFailed:
        "No pude crear la reserva en este momento. ¿Quieres intentarlo de nuevo?",
      bookingCreated: (id: string) =>
        `Reserva creada. ID: ${id}. ¿Quieres añadir algún detalle extra?`,
      cancelled: "Reserva cancelada. Si quieres empezar de nuevo, avísame.",
      goodbye: "¡Gracias! Si quieres reservar más tarde, avísame.",
    };
  }

  if (language === "Vietnamese") {
    return {
      askDates:
        "Bạn muốn đặt xe cho ngày nào? Vui lòng dùng định dạng YYYY-MM-DD đến YYYY-MM-DD.",
      askIntake: (fields: string) =>
        `Để tạo đặt xe, mình cần: ${fields}.`,
      clarifyVehicle: (options: string) =>
        `Bạn muốn đặt xe nào?\n${options}`,
      noAvailability:
        "Mình chưa thấy xe trống cho các ngày đó. Bạn muốn chọn ngày khác không?",
      bookingFailed:
        "Hiện chưa thể tạo đặt xe. Bạn muốn thử lại không?",
      bookingCreated: (id: string) =>
        `Đã tạo đặt xe. Mã: ${id}. Bạn muốn bổ sung chi tiết gì không?`,
      cancelled: "Đã huỷ quy trình đặt xe. Nếu muốn bắt đầu lại, hãy nói mình.",
      goodbye: "Cảm ơn bạn! Khi cần đặt xe, cứ nói mình nhé.",
    };
  }

  return {
    askDates: "What dates do you want to book? Use YYYY-MM-DD to YYYY-MM-DD.",
    askIntake: (fields: string) =>
      `To create the booking I need: ${fields}.`,
    clarifyVehicle: (options: string) =>
      `Which vehicle would you like to book?\n${options}`,
    noAvailability:
      "I don’t see availability for those dates. Want to try different dates?",
    bookingFailed:
      "I couldn’t create the booking right now. Want to try again?",
    bookingCreated: (id: string) =>
      `Booking created. ID: ${id}. Do you want to add any extra details?`,
    cancelled: "Booking cancelled. If you want to start again, just tell me.",
    goodbye: "Thanks! If you want to book later, just let me know.",
  };
}

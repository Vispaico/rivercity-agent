import { supabase } from "./supabase.js";

type AvailabilityRow = {
  vehicle_id: string;
  available_count: number;
};

type VehicleRow = {
  id: string;
  name?: string | null;
  brand?: string | null;
  model?: string | null;
  type?: string | null;
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

  if (!intent && !session.active) return null;

  if (isCancelIntent(message)) {
    await clearSession(sessionId);
    return bookingCopy(userLanguage).cancelled;
  }

  session.active = true;
  await upsertSession(sessionId, session);

  const dates = extractDates(message) ?? {
    startDate: session.startDate,
    endDate: session.endDate,
  };
  if (!dates?.startDate || !dates?.endDate) {
    session.active = true;
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
    const availability = await getAvailability(startDate, endDate);
    if (!availability.length) {
      await upsertSession(sessionId, session);
      return bookingCopy(userLanguage).noAvailability;
    }

    const vehicles = await getVehiclesByIds(
      availability.map((row) => row.vehicle_id)
    );

    const availableVehicles = vehicles
      .map((vehicle) => {
        const match = availability.find((row) => row.vehicle_id === vehicle.id);
        return match ? { vehicle, available: match.available_count } : null;
      })
      .filter(Boolean) as { vehicle: VehicleRow; available: number }[];

    if (!availableVehicles.length) {
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
    await upsertSession(sessionId, session);
    return formatAvailabilityList(userLanguage, session.availableVehicles);
  }

  if (selected.length > 1) {
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

function extractDates(message: string) {
  const matches = message.match(/\d{4}-\d{2}-\d{2}/g);
  if (!matches || matches.length < 2) return null;
  return { startDate: matches[0], endDate: matches[1] };
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

async function getAvailability(startDate: string, endDate: string) {
  const { data, error } = await supabase.rpc("get_vehicle_availability", {
    p_start_date: startDate,
    p_end_date: endDate,
  });

  if (error) {
    console.error("[booking] availability error:", error);
    return [];
  }

  return (data as AvailabilityRow[]) || [];
}

async function getVehiclesByIds(ids: string[]) {
  if (!ids.length) return [];

  const { data, error } = await supabase
    .from("vehicles")
    .select(
      "id,name,brand,model,type,price_per_hour,price_per_day,price_per_week,price_per_month,currency"
    )
    .in("id", ids);

  if (error) {
    console.error("[booking] vehicles fetch error:", error);
    return [];
  }

  return (data as VehicleRow[]) || [];
}

async function resolveVehicleSelection(
  message: string,
  preference: string | null,
  vehicles: VehicleRow[]
) {
  const lower = message.toLowerCase();
  const matches = vehicles.filter((vehicle) => {
    const name = [vehicle.name, vehicle.brand, vehicle.model]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (name && lower.includes(name)) return true;
    if (preference === "car" && vehicle.type?.toLowerCase().includes("car"))
      return true;
    if (
      preference === "motorbike" &&
      vehicle.type?.toLowerCase().includes("bike")
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

function formatAvailabilityList(
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

function formatVehicle(vehicle: VehicleRow) {
  const name = [vehicle.name, vehicle.brand, vehicle.model]
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
  };
}

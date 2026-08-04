export const defaultTemplates = [
  { type: 'QUEUE_CONFIRMATION', title: 'የወረፋ ማረጋገጫ', body: 'ሰላም {customer_name}፣ ተራዎ {queue_number} ነው። የሚጠበቀው ጊዜ {wait_minutes} ደቂቃ ነው።' },
  { type: 'NEXT_CUSTOMER', title: 'ተራዎ ቀርቧል', body: 'ሰላም {customer_name}፣ ተራዎ ቀርቧል። እባክዎ ወደ {business_name} ይምጡ።' },
  { type: 'DELAY', title: 'የመዘግየት ማሳወቂያ', body: 'ሰላም {customer_name}፣ ወረፋው ትንሽ ዘግይቷል። አዲሱ ግምት {wait_minutes} ደቂቃ ነው።' },
  { type: 'APPOINTMENT_REMINDER', title: 'የቀጠሮ ማስታወሻ', body: 'ሰላም {customer_name}፣ በ{appointment_date} {appointment_time} ከ{business_name} ጋር ቀጠሮ አለዎት።' },
  { type: 'CANCELLATION', title: 'ስረዛ', body: 'ሰላም {customer_name}፣ ቀጠሮዎ ተሰርዟል።' },
  { type: 'THANK_YOU', title: 'እናመሰግናለን', body: 'ሰላም {customer_name}፣ {business_name}ን ስለመረጡ እናመሰግናለን።' },
  { type: 'PROMOTION', title: 'ልዩ ቅናሽ', body: 'ሰላም {customer_name}፣ ከ{business_name} ልዩ ቅናሽ አለን።' },
];

export const templateRows = (businessId) => defaultTemplates.map((template) => ({ ...template, businessId }));

export function renderTemplate(body, variables = {}) {
  return body.replace(/\{([a-z_]+)\}/gi, (_match, key) => String(variables[key] ?? `{${key}}`));
}

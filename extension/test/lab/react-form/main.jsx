// Lab page (invented company): an application form built the way modern
// applicant systems build theirs — a real React app with controlled inputs, a
// react-select-style search dropdown, a location look-up that answers after a
// delay, Yes/No buttons and a date. Everything lives in React state, exposed as
// window.__formData() so tests check what the PAGE holds, not what's painted.
import React, { useEffect, useId, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

const CITIES = ["Harborview, OR", "Harbor City, CA", "Hartford, CT", "Portland, OR"];

/** A search dropdown shaped like react-select: input role=combobox, a menu of
 *  role=option, the choice shown in its own element. */
function SearchSelect({ label, options, value, onChange, lookup }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [found, setFound] = useState(options || []);
  const timer = useRef();
  useEffect(() => {
    if (!lookup) return setFound((options || []).filter((o) => o.toLowerCase().includes(text.toLowerCase())));
    clearTimeout(timer.current);
    if (!text) return setFound([]);
    timer.current = setTimeout(() => setFound(CITIES.filter((c) => c.toLowerCase().startsWith(text.toLowerCase().split(",")[0]))), 300);
  }, [text, lookup, options]);
  const pick = (o) => {
    onChange(o);
    setText("");
    setOpen(false);
  };
  return (
    <div className="field">
      <label id={`${id}-l`} htmlFor={`${id}-i`}>{label}</label>
      <div className="select__control" onMouseDown={() => setOpen(true)}>
        {value && !text && <div className="select__single-value">{value}</div>}
        <input
          id={`${id}-i`}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-menu`}
          aria-autocomplete="list"
          aria-labelledby={`${id}-l`}
          autoComplete="off"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setOpen(true);
            if (e.key === "Escape") setOpen(false);
          }}
        />
      </div>
      {open && found.length > 0 && (
        <div id={`${id}-menu`} role="listbox" className="select__menu">
          {found.map((o) => (
            <div key={o} role="option" aria-selected={o === value} onClick={() => pick(o)}>
              {o}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function YesNo({ label, value, onChange }) {
  return (
    <div className="field" role="group" aria-label={label}>
      <div className="label">{label}</div>
      {["Yes", "No"].map((o) => (
        <button key={o} type="button" aria-pressed={value === o} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

function Text({ label, value, onChange, type = "text" }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function App() {
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    authorized: "",
    sponsorship: "",
    location: "",
    relocate: "",
    hearAbout: "",
    startDate: "",
    gender: "",
  });
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  useEffect(() => {
    window.__formData = () => form;
  }, [form]);
  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <h1>Apply: Support Engineer at Quillstone</h1>
      <Text label="First name" value={form.firstName} onChange={set("firstName")} />
      <Text label="Last name" value={form.lastName} onChange={set("lastName")} />
      <Text label="Email" type="email" value={form.email} onChange={set("email")} />
      <Text label="Phone" type="tel" value={form.phone} onChange={set("phone")} />
      <SearchSelect
        label="Are you legally authorized to work in the United States?"
        options={["Yes, I am authorized", "No, I am not authorized"]}
        value={form.authorized}
        onChange={set("authorized")}
      />
      <SearchSelect label="Will you now or in the future require visa sponsorship?" options={["Yes", "No"]} value={form.sponsorship} onChange={set("sponsorship")} />
      <SearchSelect label="Location (City)" lookup value={form.location} onChange={set("location")} />
      <YesNo label="Are you willing to relocate?" value={form.relocate} onChange={set("relocate")} />
      <Text label="How did you hear about this job?" value={form.hearAbout} onChange={set("hearAbout")} />
      <Text label="Earliest start date" type="date" value={form.startDate} onChange={set("startDate")} />
      <SearchSelect label="Gender" options={["Female", "Male", "Non-binary", "Decline to self-identify"]} value={form.gender} onChange={set("gender")} />
      <button type="submit">Submit application</button>
    </form>
  );
}

createRoot(document.getElementById("root")).render(<App />);

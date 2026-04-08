function Spinner({ label }) {
  return (
    <div className="spinner-row">
      <span className="spinner" />
      <span>{label}</span>
    </div>
  );
}

export default Spinner;

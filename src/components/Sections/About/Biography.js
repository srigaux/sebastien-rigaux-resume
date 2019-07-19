import React from 'react';
import PropTypes from 'prop-types';

// https://stackoverflow.com/a/24181701/3672660
function calculateAge(birthday) {
  // birthday is a date
  var ageDifMs = Date.now() - birthday.getTime();
  var ageDate = new Date(ageDifMs); // miliseconds from epoch
  return Math.abs(ageDate.getUTCFullYear() - 1970);
}

const Biography = ({ birthday, firstExperienceDate, children }) => {
  var age = calculateAge(new Date(birthday));
  var experienceYears = calculateAge(new Date(firstExperienceDate));

  return (
    <p className="lead ">
      {children
        .replace('{{age}}', age)
        .replace('{{experienceYears}}', experienceYears)}
    </p>
  );
};

Biography.propTypes = {
  birthday: PropTypes.string.isRequired,
  firstExperienceDate: PropTypes.string.isRequired,
  children: PropTypes.string.isRequired,
};

export default Biography;
